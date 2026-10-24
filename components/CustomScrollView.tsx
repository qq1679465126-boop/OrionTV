import React, { useCallback, useRef, useState, useEffect, useImperativeHandle } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, BackHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";

interface CustomScrollViewProps {
  data: any[];
  renderItem: ({ item, index }: { item: any; index: number }) => React.ReactNode;
  numColumns?: number; // 如果不提供，将使用响应式默认值
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  onEndReached?: () => void;
  loadMoreThreshold?: number;
  emptyMessage?: string;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
}

// 对外暴露的能力：TV 端焦点行居中滚动（哔哩哔哩TV版形式）
export interface CustomScrollViewHandle {
  scrollRowToCenter: (rowIndex: number) => void;
}

const CustomScrollView = React.forwardRef<CustomScrollViewHandle, CustomScrollViewProps>(({
  data,
  renderItem,
  numColumns,
  loading = false,
  loadingMore = false,
  error = null,
  onEndReached,
  loadMoreThreshold = 200,
  emptyMessage = "暂无内容",
  ListFooterComponent,
}, ref) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const firstCardRef = useRef<any>(null); // <--- 新增
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);
  const rowLayouts = useRef<Record<number, { y: number; h: number }>>({});
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType } = responsiveConfig;

  // TV 端：把指定行滚动到屏幕垂直居中位置
  const scrollRowToCenter = useCallback(
    (rowIndex: number) => {
      const layout = rowLayouts.current[rowIndex];
      if (!layout || scrollViewHeight <= 0) return;
      const targetY = Math.max(0, layout.y + layout.h / 2 - scrollViewHeight / 2);
      scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
    },
    [scrollViewHeight]
  );

  useImperativeHandle(ref, () => ({ scrollRowToCenter }), [scrollRowToCenter]);

  // 添加返回键处理逻辑
  useEffect(() => {
    if (deviceType === 'tv') {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showScrollToTop) {
          scrollToTop();
          return true; // 阻止默认的返回行为
        }
        return false; // 允许默认的返回行为
      });

      return () => backHandler.remove();
    }
  }, [showScrollToTop,deviceType]);

  // 使用响应式列数，如果没有明确指定的话
  const effectiveColumns = numColumns || responsiveConfig.columns;

  const handleScroll = useCallback(
    ({ nativeEvent }: { nativeEvent: any }) => {
      const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
      const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - loadMoreThreshold;

      // 显示/隐藏返回顶部按钮
      setShowScrollToTop(contentOffset.y > 200);

      if (isCloseToBottom && !loadingMore && onEndReached) {
        onEndReached();
      }
    },
    [onEndReached, loadingMore, loadMoreThreshold]
  );

  const scrollToTop = () => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    // 滚动动画结束后聚焦第一个卡片
    setTimeout(() => {
      firstCardRef.current?.focus();
    }, 500); // 500ms 适配大多数动画时长
  };

  const renderFooter = () => {
    if (ListFooterComponent) {
      if (React.isValidElement(ListFooterComponent)) {
        return ListFooterComponent;
      } else if (typeof ListFooterComponent === "function") {
        const Component = ListFooterComponent as React.ComponentType<any>;
        return <Component />;
      }
      return null;
    }
    if (loadingMore) {
      return <ActivityIndicator style={{ marginVertical: 20 }} size="large" />;
    }
    return null;
  };

  if (loading) {
    return (
      <View style={commonStyles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={commonStyles.center}>
        <ThemedText type="subtitle" style={{ padding: responsiveConfig.spacing }}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={commonStyles.center}>
        <ThemedText>{emptyMessage}</ThemedText>
      </View>
    );
  }

  // 将数据按行分组
  const groupItemsByRow = (items: any[], columns: number) => {
    const rows = [];
    for (let i = 0; i < items.length; i += columns) {
      rows.push(items.slice(i, i + columns));
    }
    return rows;
  };

  const rows = groupItemsByRow(data, effectiveColumns);

  // 动态样式
  const dynamicStyles = StyleSheet.create({
    listContent: {
      paddingBottom: responsiveConfig.spacing * 2,
      paddingHorizontal: responsiveConfig.spacing / 2,
    },
    rowContainer: {
      flexDirection: "row",
      marginBottom: responsiveConfig.spacing,
    },
    fullRowContainer: {
      justifyContent: "space-around",
      marginRight: responsiveConfig.spacing / 2,
    },
    partialRowContainer: {
      justifyContent: "flex-start",
    },
    itemContainer: {
      width: responsiveConfig.cardWidth,
    },
    itemWithMargin: {
      width: responsiveConfig.cardWidth,
      marginRight: responsiveConfig.spacing,
    },
    scrollToTopButton: {
      position: 'absolute',
      right: responsiveConfig.spacing,
      bottom: responsiveConfig.spacing * 2,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      padding: responsiveConfig.spacing,
      borderRadius: responsiveConfig.spacing,
      opacity: showScrollToTop ? 1 : 0,
    },
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={dynamicStyles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={responsiveConfig.deviceType !== 'tv'}
        onLayout={(e) => setScrollViewHeight(e.nativeEvent.layout.height)}
      >
        {data.length > 0 ? (
          <>
            {rows.map((row, rowIndex) => {
              const isFullRow = row.length === effectiveColumns;
              const rowStyle = isFullRow ? dynamicStyles.fullRowContainer : dynamicStyles.partialRowContainer;

              return (
                <View
                  key={rowIndex}
                  style={[dynamicStyles.rowContainer, rowStyle]}
                  onLayout={(e) => {
                    rowLayouts.current[rowIndex] = {
                      y: e.nativeEvent.layout.y,
                      h: e.nativeEvent.layout.height,
                    };
                  }}
                >
                  {row.map((item, itemIndex) => {
                    const actualIndex = rowIndex * effectiveColumns + itemIndex;
                    const isLastItemInPartialRow = !isFullRow && itemIndex === row.length - 1;
                    const itemStyle = isLastItemInPartialRow ? dynamicStyles.itemContainer : dynamicStyles.itemWithMargin;

                    const cardProps = {
                      key: actualIndex,
                      style: isFullRow ? dynamicStyles.itemContainer : itemStyle,
                    };

                    return (
                      <View {...cardProps}>
                        {renderItem({ item, index: actualIndex })}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {renderFooter()}
          </>
        ) : (
          <View style={commonStyles.center}>
            <ThemedText>{emptyMessage}</ThemedText>
          </View>
        )}
      </ScrollView>
      {deviceType!=='tv' && (
        <TouchableOpacity
          style={dynamicStyles.scrollToTopButton}
          onPress={scrollToTop}
          activeOpacity={0.8}
        >
          <ThemedText>⬆️</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
});

CustomScrollView.displayName = "CustomScrollView";

export default CustomScrollView;
