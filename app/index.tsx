import React, { useEffect, useCallback, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, FlatList, Pressable, Animated, StatusBar, Platform, BackHandler, ToastAndroid, ScrollView, LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { api } from "@/services/api";
import VideoCard from "@/components/VideoCard";
import { useFocusEffect, useRouter } from "expo-router";
import { Search, Settings, LogOut, Heart } from "lucide-react-native";
import { StyledButton } from "@/components/StyledButton";
import useHomeStore, { RowItem, Category } from "@/stores/homeStore";
import useAuthStore from "@/stores/authStore";
import CustomScrollView, { CustomScrollViewHandle } from "@/components/CustomScrollView";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import { useApiConfig, getApiConfigErrorMessage } from "@/hooks/useApiConfig";
import { Colors } from "@/constants/Colors";

const LOAD_MORE_THRESHOLD = 200;

// 哔哩哔哩TV版形式：横向卡片行（一个栏目一排，行标题+横向滚动卡片）
function ContentRow({
  title,
  items,
  rowIndex,
  onRowLayout,
  onRowFocus,
  cardWidth,
  onRecordDeleted,
}: {
  title: string;
  items: RowItem[];
  rowIndex: number;
  onRowLayout: (rowIndex: number, e: LayoutChangeEvent) => void;
  onRowFocus: (rowIndex: number) => void;
  cardWidth: number;
  onRecordDeleted: () => void;
}) {
  const rowListRef = useRef<FlatList<RowItem> | null>(null);

  if (items.length === 0) return null;

  return (
    <View style={tvRowStyles.rowOuter} onLayout={(e) => onRowLayout(rowIndex, e)}>
      <ThemedText style={tvRowStyles.rowTitle}>{title}</ThemedText>
      <FlatList
        ref={rowListRef}
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, index) => `${item.source}-${item.id}-${index}`}
        contentContainerStyle={tvRowStyles.rowListContent}
        renderItem={({ item, index }) => (
          <View style={{ width: cardWidth, marginRight: 16 }}>
            <VideoCard
              cardWidth={cardWidth}
              id={item.id}
              source={item.source}
              title={item.title}
              poster={item.poster}
              year={item.year}
              rate={item.rate}
              progress={item.progress}
              playTime={item.play_time}
              episodeIndex={item.episodeIndex}
              sourceName={item.sourceName}
              totalEpisodes={item.totalEpisodes}
              api={api}
              onRecordDeleted={onRecordDeleted}
              hasTVPreferredFocus={rowIndex === 0 && index === 0}
              onFocus={() => {
                rowListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                onRowFocus(rowIndex);
              }}
            />
          </View>
        )}
      />
    </View>
  );
}

const tvRowStyles = StyleSheet.create({
  rowsScroll: {
    flex: 1,
  },
  rowOuter: {
    marginBottom: 28,
  },
  rowTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 12,
    paddingHorizontal: 32,
  },
  rowListContent: {
    paddingHorizontal: 32,
  },
});

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = "dark";
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const categoryListRef = useRef<FlatList<Category> | null>(null);
  const tagListRef = useRef<FlatList<string> | null>(null);
  const contentScrollRef = useRef<CustomScrollViewHandle>(null);

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const {
    categories,
    selectedCategory,
    contentData,
    loading,
    loadingMore,
    error,
    rowsData,
    rowsLoading,
    fetchInitialData,
    loadMoreData,
    fetchRowsData,
    selectCategory,
    refreshPlayRecords,
    clearError,
  } = useHomeStore();
  const { isLoggedIn, logout } = useAuthStore();
  const apiConfigStatus = useApiConfig();

  useFocusEffect(
    useCallback(() => {
      refreshPlayRecords();
    }, [refreshPlayRecords])
  );

    // 双击返回退出逻辑（只限当前页面）
  const backPressTimeRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
    const handleBackPress = () => {
      const now = Date.now();

      // 如果还没按过返回键，或距离上次超过2秒
      if (!backPressTimeRef.current || now - backPressTimeRef.current > 2000) {
        backPressTimeRef.current = now;
        ToastAndroid.show("再按一次返回键退出", ToastAndroid.SHORT);
        return true; // 拦截返回事件，不退出
      }

      // 两次返回键间隔小于2秒，退出应用
      BackHandler.exitApp();
      return true;
    };

    // 仅限 Android 平台启用此功能
    if (Platform.OS === "android") {
      const backHandler = BackHandler.addEventListener("hardwareBackPress", handleBackPress);

      // 返回首页时重置状态
      return () => {
        backHandler.remove();
        backPressTimeRef.current = null;
      };
    }
  }, [])
);

  // 统一的数据获取逻辑
  useEffect(() => {
    if (!selectedCategory) return;

    // 如果是容器分类且没有选择标签，设置默认标签
    if (selectedCategory.tags && !selectedCategory.tag) {
      const defaultTag = selectedCategory.tags[0];
      setSelectedTag(defaultTag);
      selectCategory({ ...selectedCategory, tag: defaultTag });
      return;
    }

    // 只有在API配置完成且分类有效时才获取数据
    if (apiConfigStatus.isConfigured && !apiConfigStatus.needsConfiguration) {
      // 对于有标签的分类，需要确保有标签才获取数据
      if (selectedCategory.tags && selectedCategory.tag) {
        fetchInitialData();
      }
      // 对于无标签的分类，直接获取数据
      else if (!selectedCategory.tags) {
        fetchInitialData();
      }
    }
  }, [
    selectedCategory,
    selectedCategory?.tag,
    apiConfigStatus.isConfigured,
    apiConfigStatus.needsConfiguration,
    fetchInitialData,
    selectCategory,
  ]);

  // 清除错误状态的逻辑
  useEffect(() => {
    if (apiConfigStatus.needsConfiguration && error) {
      clearError();
    }
  }, [apiConfigStatus.needsConfiguration, error, clearError]);

  // 哔哩哔哩TV版形式：TV端按标签并行拉取多行栏目数据
  useEffect(() => {
    if (
      deviceType === "tv" &&
      apiConfigStatus.isConfigured &&
      !apiConfigStatus.needsConfiguration &&
      selectedCategory
    ) {
      fetchRowsData();
    }
  }, [
    deviceType,
    selectedCategory?.title,
    apiConfigStatus.isConfigured,
    apiConfigStatus.needsConfiguration,
    fetchRowsData,
  ]);

  // TV端多行布局：焦点行居中滚动
  const rowsScrollRef = useRef<ScrollView>(null);
  const [rowsViewportH, setRowsViewportH] = useState(0);
  const rowLayoutsRef = useRef<Record<number, { y: number; h: number }>>({});

  // TV 卡片宽度自适应：海报行不超过视口高度的 72%，保证一行（含标题）完整显示
  // 大屏电视仍保持 176；投屏小屏（如手机横屏约 400dp 高）自动缩到 96-135
  const tvCardWidth =
    rowsViewportH > 0
      ? Math.max(96, Math.min(176, Math.floor((rowsViewportH * 0.72 - 110) / 1.5)))
      : 176;

  const scrollRowToCenter = useCallback(
    (rowIndex: number) => {
      const layout = rowLayoutsRef.current[rowIndex];
      if (!layout || rowsViewportH <= 0) return;
      // 焦点行滚到视口顶部（留 16px 余量）：每次上下切换滚动一整行，反馈明显
      const targetY = Math.max(0, layout.y - 16);
      rowsScrollRef.current?.scrollTo({ y: targetY, animated: true });
    },
    [rowsViewportH]
  );

  const handleRowLayout = useCallback((rowIndex: number, e: LayoutChangeEvent) => {
    rowLayoutsRef.current[rowIndex] = {
      y: e.nativeEvent.layout.y,
      h: e.nativeEvent.layout.height,
    };
  }, []);

  useEffect(() => {
    if (!loading && contentData.length > 0) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (loading) {
      fadeAnim.setValue(0);
    }
  }, [loading, contentData.length, fadeAnim]);

  const handleCategorySelect = (category: Category) => {
    setSelectedTag(null);
    selectCategory(category);
  };

  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag);
    if (selectedCategory) {
      const categoryWithTag = { ...selectedCategory, tag: tag };
      selectCategory(categoryWithTag);
    }
  };

  const renderCategory = ({ item, index }: { item: Category; index: number }) => {
    const isSelected = selectedCategory?.title === item.title;
    return (
      <StyledButton
        text={item.title}
        onPress={() => handleCategorySelect(item)}
        isSelected={isSelected}
        style={dynamicStyles.categoryButton}
        textStyle={dynamicStyles.categoryText}
        onFocus={() => {
          categoryListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }}
      />
    );
  };

  const renderContentItem = ({ item, index }: { item: RowItem; index: number }) => (
    <VideoCard
      id={item.id}
      source={item.source}
      title={item.title}
      poster={item.poster}
      year={item.year}
      rate={item.rate}
      progress={item.progress}
      playTime={item.play_time}
      episodeIndex={item.episodeIndex}
      sourceName={item.sourceName}
      totalEpisodes={item.totalEpisodes}
      api={api}
      onRecordDeleted={fetchInitialData}
      onFocus={() => {
        // 哔哩哔哩TV版形式：焦点所在行滚动到屏幕垂直居中
        contentScrollRef.current?.scrollRowToCenter(Math.floor(index / responsiveConfig.columns));
      }}
    />
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return <ActivityIndicator style={{ marginVertical: 20 }} size="large" />;
  };

  // 检查是否需要显示API配置提示
  const shouldShowApiConfig = apiConfigStatus.needsConfiguration && selectedCategory && !selectedCategory.tags;

  // 哔哩哔哩TV版形式：多行栏目渲染（每个标签一排横向卡片）
  const renderTVHome = () => {
    if (shouldShowApiConfig) {
      return (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {getApiConfigErrorMessage(apiConfigStatus)}
          </ThemedText>
        </View>
      );
    }
    if (apiConfigStatus.isValidating) {
      return (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            正在验证服务器配置...
          </ThemedText>
        </View>
      );
    }
    if (apiConfigStatus.error && !apiConfigStatus.isValid) {
      return (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {apiConfigStatus.error}
          </ThemedText>
        </View>
      );
    }

    const rows: { title: string; items: RowItem[] }[] = selectedCategory?.tags
      ? selectedCategory.tags.map((tag) => ({ title: tag, items: rowsData[tag] || [] }))
      : [{ title: selectedCategory?.title || "内容", items: contentData }];

    const hasAnyItem = rows.some((r) => r.items.length > 0);

    if (rowsLoading || loading) {
      return (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
        </View>
      );
    }
    if (error) {
      return (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing }}>
            {error}
          </ThemedText>
        </View>
      );
    }
    if (!hasAnyItem) {
      return (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing }}>
            {selectedCategory?.tags ? "该分类下暂无内容" : "暂无内容，去观看一些影片吧"}
          </ThemedText>
        </View>
      );
    }

    return (
      <ScrollView
        ref={rowsScrollRef}
        style={tvRowStyles.rowsScroll}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setRowsViewportH(e.nativeEvent.layout.height)}
      >
        {rows.map((row, i) => (
          <ContentRow
            key={`${selectedCategory?.title}-${row.title}`}
            title={row.title}
            items={row.items}
            rowIndex={i}
            onRowLayout={handleRowLayout}
            onRowFocus={scrollRowToCenter}
            cardWidth={tvCardWidth}
            onRecordDeleted={fetchInitialData}
          />
        ))}
        <View style={{ height: spacing * 3 }} />
      </ScrollView>
    );
  };

  // TV端和平板端的顶部导航
  const renderHeader = () => {
    if (deviceType === "mobile") {
      // 移动端不显示顶部导航，使用底部Tab导航
      return null;
    }

    return (
      <View style={dynamicStyles.headerContainer}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <ThemedText style={dynamicStyles.headerTitle}>首页</ThemedText>
          <Pressable android_ripple={Platform.isTV || deviceType !== 'tv'? { color: 'transparent' } : { color: Colors.dark.link }} style={{ marginLeft: 20 }} onPress={() => router.push("/live")}>
            {({ focused }) => (
              <ThemedText style={[dynamicStyles.headerTitle, { color: focused ? Colors.dark.primary : "grey", fontWeight: focused ? "bold" : "normal" }]}>直播</ThemedText>
            )}
          </Pressable>
        </View>
        <View style={dynamicStyles.rightHeaderButtons}>
          <StyledButton style={dynamicStyles.iconButton} onPress={() => router.push("/favorites")} variant="ghost">
            <Heart color={colorScheme === "dark" ? "white" : "black"} size={24} />
          </StyledButton>
          <StyledButton
            style={dynamicStyles.iconButton}
            onPress={() => router.push({ pathname: "/search" })}
            variant="ghost"
          >
            <Search color={colorScheme === "dark" ? "white" : "black"} size={24} />
          </StyledButton>
          <StyledButton style={dynamicStyles.iconButton} onPress={() => router.push("/settings")} variant="ghost">
            <Settings color={colorScheme === "dark" ? "white" : "black"} size={24} />
          </StyledButton>
          {isLoggedIn && (
            <StyledButton style={dynamicStyles.iconButton} onPress={logout} variant="ghost">
              <LogOut color={colorScheme === "dark" ? "white" : "black"} size={24} />
            </StyledButton>
          )}
        </View>
      </View>
    );
  };

  // 动态样式
  const dynamicStyles = StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: deviceType === "mobile" ? insets.top : deviceType === "tablet" ? insets.top + 20 : 40,
    },
    headerContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: deviceType === "tv" ? spacing * 2 : spacing * 1.5,
      marginBottom: spacing,
    },
    headerTitle: {
      fontSize: deviceType === "mobile" ? 24 : deviceType === "tablet" ? 28 : 32,
      fontWeight: "bold",
      paddingTop: 16,
    },
    rightHeaderButtons: {
      flexDirection: "row",
      alignItems: "center",
    },
    iconButton: {
      borderRadius: 30,
      marginLeft: spacing / 2,
    },
    categoryContainer: {
      paddingBottom: spacing / 2,
    },
    categoryListContent: {
      paddingHorizontal: deviceType === "tv" ? spacing * 2 : spacing,
    },
    categoryButton: {
      paddingHorizontal: deviceType === "tv" ? spacing * 0.75 : spacing / 2,
      paddingVertical: deviceType === "tv" ? 12 : spacing / 2,
      borderRadius: deviceType === "mobile" ? 6 : 8,
      marginHorizontal: deviceType === "tv" ? spacing / 4 : spacing / 2, // TV端使用更小的间距
    },
    categoryText: {
      fontSize: deviceType === "mobile" ? 14 : deviceType === "tv" ? 19 : 16,
      fontWeight: "500",
    },
    contentContainer: {
      flex: 1,
    },
  });

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {/* 状态栏 */}
      {deviceType === "mobile" && <StatusBar barStyle="light-content" />}

      {/* 顶部导航 */}
      {renderHeader()}

      {/* 分类选择器 */}
      <View style={dynamicStyles.categoryContainer}>
        <FlatList
          ref={categoryListRef}
          data={categories}
          renderItem={renderCategory}
          keyExtractor={(item) => item.title}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={dynamicStyles.categoryListContent}
        />
      </View>

      {deviceType === "tv" ? (
        renderTVHome()
      ) : (
        <>
      {/* 子分类标签 */}
      {selectedCategory && selectedCategory.tags && (
        <View style={dynamicStyles.categoryContainer}>
          <FlatList
            ref={tagListRef}
            data={selectedCategory.tags}
            renderItem={({ item, index }) => {
              const isSelected = selectedTag === item;
              return (
                <StyledButton
                  hasTVPreferredFocus={selectedTag === null && index === 0}
                  text={item}
                  onPress={() => handleTagSelect(item)}
                  isSelected={isSelected}
                  style={dynamicStyles.categoryButton}
                  textStyle={dynamicStyles.categoryText}
                  variant="ghost"
                  onFocus={() => {
                    tagListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
                  }}
                />
              );
            }}
            keyExtractor={(item) => item}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={dynamicStyles.categoryListContent}
          />
        </View>
      )}

      {/* 内容网格 */}
      {shouldShowApiConfig ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {getApiConfigErrorMessage(apiConfigStatus)}
          </ThemedText>
        </View>
      ) : apiConfigStatus.isValidating ? (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            正在验证服务器配置...
          </ThemedText>
        </View>
      ) : apiConfigStatus.error && !apiConfigStatus.isValid ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing, textAlign: "center" }}>
            {apiConfigStatus.error}
          </ThemedText>
        </View>
      ) : loading ? (
        <View style={commonStyles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <View style={commonStyles.center}>
          <ThemedText type="subtitle" style={{ padding: spacing }}>
            {error}
          </ThemedText>
        </View>
      ) : (
        <Animated.View style={[dynamicStyles.contentContainer, { opacity: fadeAnim }]}>
          <CustomScrollView
            ref={contentScrollRef}
            data={contentData}
            renderItem={renderContentItem}
            loading={loading}
            loadingMore={loadingMore}
            error={error}
            onEndReached={loadMoreData}
            loadMoreThreshold={LOAD_MORE_THRESHOLD}
            emptyMessage={selectedCategory?.tags ? "请选择一个子分类" : "该分类下暂无内容"}
            ListFooterComponent={renderFooter}
          />
        </Animated.View>
      )}
        </>
      )}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === "tv") {
    return content;
  }

  return <ResponsiveNavigation>{content}</ResponsiveNavigation>;
}
