import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Image, ScrollView, ActivityIndicator, Modal, FlatList, ToastAndroid } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { FontAwesome } from "@expo/vector-icons";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";

export default function DetailScreen() {
  const { q, source, id } = useLocalSearchParams<{ q: string; source?: string; id?: string }>();
  const router = useRouter();

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const {
    detail,
    searchResults,
    loading,
    error,
    allSourcesLoaded,
    init,
    setDetail,
    abort,
    isFavorited,
    toggleFavorite,
  } = useDetailStore();

  useEffect(() => {
    if (q) {
      init(q, source, id);
    }
    return () => {
      abort();
    };
  }, [abort, init, q, source, id]);

  const handlePlay = async (episodeIndex: number) => {
    if (!detail) return;
    abort(); // Cancel any ongoing fetches

    // 播放前自动挑选最优源：并发测速全部源（速度+画质评分），3分钟内缓存结果
    if (searchResults.length > 1) {
      ToastAndroid.show("正在挑选最快的播放源…", ToastAndroid.SHORT);
      try {
        const bestSource = await pickBestSource(detail.title);
        if (bestSource) {
          const bestItem = searchResults.find((s) => s.source === bestSource);
          if (bestItem) {
            router.push({
              pathname: "/play",
              params: {
                q: bestItem.title,
                source: bestItem.source,
                id: bestItem.id.toString(),
                episodeIndex: episodeIndex.toString(),
              },
            });
            return;
          }
        }
      } catch {
        // 测速失败则按当前源播放
      }
    }

    router.push({
      pathname: "/play",
      params: {
        // Pass necessary identifiers, the rest will be in the store
        q: detail.title,
        source: detail.source,
        id: detail.id.toString(),
        episodeIndex: episodeIndex.toString(),
      },
    });
  };

  // 剧集折叠：剧集较多时默认只显示一部分，可展开全部
  const [episodesExpanded, setEpisodesExpanded] = useState(false);
  const EPISODE_LIMIT = 30;
  const displayedEpisodes = detail
    ? episodesExpanded
      ? detail.episodes
      : detail.episodes.slice(0, EPISODE_LIMIT)
    : [];

  // 播放源测速：并发请求每个源第一集的 m3u8 片段（64KB），按真实下载耗时排序
  interface SpeedResult {
    source: string;
    sourceName: string;
    ms: number | null;
    resolution?: string | null;
  }
  const [speedTest, setSpeedTest] = useState<{
    status: "running" | "done";
    progress: number;
    total: number;
    results: SpeedResult[];
  } | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  // 单源测速：下载 m3u8 片段计时，并从 master 清单解析分辨率
  const measureSource = useCallback(async (item: (typeof searchResults)[number]): Promise<SpeedResult> => {
    const m3u8 = item.episodes?.[0];
    if (!m3u8) return { source: item.source, sourceName: item.source_name, ms: null };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const t0 = Date.now();
    try {
      const resp = await fetch(m3u8, {
        headers: { Range: "bytes=0-65535" },
        signal: ctrl.signal,
      });
      const text = await resp.text();
      const ms = Date.now() - t0;
      let resolution: string | null = null;
      const m = text.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (m) {
        const h = parseInt(m[2], 10);
        resolution = h >= 1600 ? "4K" : h >= 1000 ? "1080P" : h >= 700 ? "720P" : "480P";
      }
      return { source: item.source, sourceName: item.source_name, ms, resolution };
    } catch {
      return { source: item.source, sourceName: item.source_name, ms: null };
    } finally {
      clearTimeout(timer);
    }
  }, [searchResults]);

  const runSpeedTest = useCallback(async () => {
    if (searchResults.length === 0) return;
    setSpeedTest({ status: "running", progress: 0, total: searchResults.length, results: [] });

    let completed = 0;
    const results: SpeedResult[] = [];

    await Promise.all(
      searchResults.map(async (item) => {
        const r = await measureSource(item);
        completed += 1;
        results.push(r);
        setSpeedTest((s) =>
          s && s.status === "running"
            ? { ...s, progress: completed, results: [...s.results, r] }
            : s
        );
      })
    );

    results.sort((a, b) => (a.ms ?? 99999) - (b.ms ?? 99999));
    setSpeedTest({
      status: "done",
      progress: results.length,
      total: searchResults.length,
      results,
    });
  }, [searchResults, measureSource]);

  // 播放自动选优：综合评分 = 下载耗时 + 画质加成（越高画质加成越小），同一部片3分钟内缓存
  const bestSourceCacheRef = useRef<{ title: string; time: number; source: string | null } | null>(null);

  const pickBestSource = useCallback(
    async (title: string): Promise<string | null> => {
      const cache = bestSourceCacheRef.current;
      if (cache && cache.title === title && Date.now() - cache.time < 3 * 60 * 1000) {
        return cache.source;
      }
      if (searchResults.length <= 1) {
        const only = searchResults[0]?.source ?? null;
        bestSourceCacheRef.current = { title, time: Date.now(), source: only };
        return only;
      }

      const partial: SpeedResult[] = [];
      const allDone = Promise.all(
        searchResults.map(async (item) => {
          const r = await measureSource(item);
          partial.push(r);
          return r;
        })
      );
      // 最多等4秒：先到先用已完成的结果，不等慢源
      const results = await Promise.race([
        allDone.then(() => partial.slice()),
        new Promise<SpeedResult[]>((resolve) => setTimeout(() => resolve(partial.slice()), 4000)),
      ]);

      const valid = results.filter((r) => r.ms !== null);
      const best = valid.length
        ? valid.sort((a, b) => scoreSource(a) - scoreSource(b))[0].source
        : searchResults[0]?.source ?? null;
      bestSourceCacheRef.current = { title, time: Date.now(), source: best };
      return best;
    },
    [searchResults, measureSource]
  );

  const scoreSource = (r: SpeedResult): number => {
    const resBonus =
      r.resolution === "4K" || r.resolution === "1080P"
        ? 0
        : r.resolution === "720P"
          ? 200
          : r.resolution === "480P"
            ? 500
            : 350;
    return (r.ms as number) + resBonus;
  };

  // 弹窗里的源列表：测速完成后按速度排序
  const sortedSourceList =
    speedTest?.status === "done"
      ? [...searchResults].sort((a, b) => {
          const ma = speedTest.results.find((r) => r.source === a.source)?.ms ?? 99999;
          const mb = speedTest.results.find((r) => r.source === b.source)?.ms ?? 99999;
          return ma - mb;
        })
      : searchResults;

  const msOf = (s: string): number | null | undefined =>
    speedTest?.status === "done" ? speedTest.results.find((r) => r.source === s)?.ms : undefined;

  const renderSpeedTest = () => (
    <View style={dynamicStyles.speedPanel}>
      <View style={dynamicStyles.speedHeaderRow}>
        <ThemedText style={dynamicStyles.speedTitle}>播放源测速</ThemedText>
        {speedTest?.status === "done" && (
          <StyledButton
            text="重新测速"
            variant="ghost"
            onPress={runSpeedTest}
            style={dynamicStyles.speedButton}
            textStyle={dynamicStyles.speedButtonText}
          />
        )}
      </View>
      {!speedTest && (
        <StyledButton
          text="开始测速，找出最快的源"
          variant="ghost"
          onPress={runSpeedTest}
          style={dynamicStyles.speedButton}
          textStyle={dynamicStyles.speedButtonText}
        />
      )}
      {speedTest?.status === "running" && (
        <ThemedText style={dynamicStyles.speedRunningText}>
          测速中 {speedTest.progress}/{speedTest.total}，请稍候…
        </ThemedText>
      )}
      {speedTest?.status === "done" && (
        <>
          {speedTest.results.map((r) => (
            <View key={r.source} style={dynamicStyles.speedRow}>
              <ThemedText style={dynamicStyles.speedRankText}>
                {speedTest.results.indexOf(r) + 1}
              </ThemedText>
              <ThemedText numberOfLines={1} style={dynamicStyles.speedNameText}>
                {r.sourceName}
                {detail?.source === r.source ? "（使用中）" : ""}
              </ThemedText>
              <ThemedText
                style={
                  r.ms === null
                    ? dynamicStyles.speedMsTimeout
                    : speedTest.results[0]?.source === r.source
                      ? dynamicStyles.speedMsFast
                      : dynamicStyles.speedMsText
                }
              >
                {r.ms === null
                  ? "超时"
                  : `${r.ms}ms${speedTest.results[0]?.source === r.source ? " ⚡最快" : ""}`}
              </ThemedText>
            </View>
          ))}
          {speedTest.results[0] &&
            speedTest.results[0].ms !== null &&
            detail?.source !== speedTest.results[0].source && (
              <StyledButton
                text="切换到最快的源"
                variant="primary"
                onPress={() => {
                  const fastest = searchResults.find(
                    (s) => s.source === speedTest.results[0].source
                  );
                  if (fastest) setDetail(fastest);
                }}
                style={dynamicStyles.speedSwitchButton}
                textStyle={dynamicStyles.speedButtonText}
              />
            )}
        </>
      )}
    </View>
  );

  // 切换源弹窗：顶部测速面板，下方全部源列表（测速后按速度排序）
  const renderSourcePicker = () => (
    <Modal
      visible={showSourcePicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowSourcePicker(false)}
    >
      <View style={pickerStyles.overlay}>
        <View style={[pickerStyles.content, deviceType === "tv" && pickerStyles.contentTV]}>
          <View style={pickerStyles.headerRow}>
            <Text style={pickerStyles.title}>切换播放源</Text>
            <StyledButton
              text="关闭"
              variant="ghost"
              onPress={() => setShowSourcePicker(false)}
              style={pickerStyles.closeButton}
              textStyle={pickerStyles.pickerButtonText}
            />
          </View>
          {renderSpeedTest()}
          <FlatList
            data={sortedSourceList}
            keyExtractor={(item, index) => `pick-${item.source}-${index}`}
            contentContainerStyle={pickerStyles.listContent}
            renderItem={({ item, index }) => {
              const ms = msOf(item.source);
              return (
                <StyledButton
                  text={
                    ms === undefined
                      ? item.source_name
                      : `${index + 1}. ${item.source_name}（${ms === null ? "超时" : `${ms}ms`}）`
                  }
                  onPress={() => {
                    setDetail(item);
                    setShowSourcePicker(false);
                  }}
                  isSelected={detail?.source === item.source}
                  style={pickerStyles.sourceItem}
                  textStyle={pickerStyles.sourceItemText}
                />
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return <VideoLoadingAnimation showProgressBar={false} />;
  }

  if (error) {
    const content = (
      <ThemedView style={[commonStyles.safeContainer, commonStyles.center]}>
        <ThemedText type="subtitle" style={commonStyles.textMedium}>
          {error}
        </ThemedText>
      </ThemedView>
    );

    if (deviceType === 'tv') {
      return content;
    }

    return (
      <ResponsiveNavigation>
        <ResponsiveHeader title="详情" showBackButton />
        {content}
      </ResponsiveNavigation>
    );
  }

  if (!detail) {
    const content = (
      <ThemedView style={[commonStyles.safeContainer, commonStyles.center]}>
        <ThemedText type="subtitle">未找到详情信息</ThemedText>
      </ThemedView>
    );

    if (deviceType === 'tv') {
      return content;
    }

    return (
      <ResponsiveNavigation>
        <ResponsiveHeader title="详情" showBackButton />
        {content}
      </ResponsiveNavigation>
    );
  }

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  const renderDetailContent = () => {
    if (deviceType === 'mobile') {
      // 移动端垂直布局
      return (
        <ScrollView style={dynamicStyles.scrollContainer}>
          {/* 海报和基本信息 */}
          <View style={dynamicStyles.mobileTopContainer}>
            <Image source={{ uri: detail.poster }} style={dynamicStyles.mobilePoster} />
            <View style={dynamicStyles.mobileInfoContainer}>
              <View style={dynamicStyles.titleContainer}>
                <ThemedText style={dynamicStyles.title} numberOfLines={2}>
                  {detail.title}
                </ThemedText>
                <StyledButton onPress={toggleFavorite} variant="ghost" style={dynamicStyles.favoriteButton}>
                  <FontAwesome
                    name={isFavorited ? "heart" : "heart-o"}
                    size={20}
                    color={isFavorited ? "#feff5f" : "#ccc"}
                  />
                </StyledButton>
              </View>
              <View style={dynamicStyles.metaContainer}>
                <ThemedText style={dynamicStyles.metaText}>{detail.year}</ThemedText>
                <ThemedText style={dynamicStyles.metaText}>{detail.type_name}</ThemedText>
              </View>
            </View>
          </View>

          {/* 描述 */}
          <View style={dynamicStyles.descriptionContainer}>
            <ThemedText style={dynamicStyles.description}>{detail.desc}</ThemedText>
          </View>

          {/* 播放源：只显示当前源，其余收进「切换源」弹窗 */}
          <View style={dynamicStyles.sourcesContainer}>
            <View style={dynamicStyles.sourcesTitleContainer}>
              <ThemedText style={dynamicStyles.sourcesTitle}>播放源 ({searchResults.length})</ThemedText>
              {!allSourcesLoaded && <ActivityIndicator style={{ marginLeft: 10 }} />}
            </View>
            <View style={dynamicStyles.currentSourceRow}>
              <ThemedText numberOfLines={1} style={dynamicStyles.currentSourceName}>
                {detail?.source_name || "加载中"}
                {detail?.resolution ? ` · ${detail.resolution}` : ""}
              </ThemedText>
              <StyledButton
                text="切换源"
                variant="primary"
                onPress={() => setShowSourcePicker(true)}
                style={dynamicStyles.switchSourceButton}
                textStyle={dynamicStyles.switchSourceButtonText}
              />
            </View>
          </View>

          {/* 剧集列表 */}
          <View style={dynamicStyles.episodesContainer}>
            <ThemedText style={dynamicStyles.episodesTitle}>播放列表</ThemedText>
            <View style={dynamicStyles.episodeList}>
              {displayedEpisodes.map((episode, index) => (
                <StyledButton
                  key={index}
                  style={dynamicStyles.episodeButton}
                  onPress={() => handlePlay(index)}
                  text={`第 ${index + 1} 集`}
                  textStyle={dynamicStyles.episodeButtonText}
                />
              ))}
              {detail.episodes.length > EPISODE_LIMIT && (
                <StyledButton
                  text={episodesExpanded ? "收起剧集" : `展开全部 ${detail.episodes.length} 集`}
                  variant="ghost"
                  onPress={() => setEpisodesExpanded(!episodesExpanded)}
                  style={dynamicStyles.expandButton}
                  textStyle={dynamicStyles.expandButtonText}
                />
              )}
            </View>
          </View>
        </ScrollView>
      );
    } else {
      // 平板和TV端水平布局
      return (
        <ScrollView style={dynamicStyles.scrollContainer}>
          <View style={dynamicStyles.topContainer}>
            <Image source={{ uri: detail.poster }} style={dynamicStyles.poster} />
            <View style={dynamicStyles.infoContainer}>
              <View style={dynamicStyles.titleContainer}>
                <ThemedText style={dynamicStyles.title} numberOfLines={1} ellipsizeMode="tail">
                  {detail.title}
                </ThemedText>
                <StyledButton onPress={toggleFavorite} variant="ghost" style={dynamicStyles.favoriteButton}>
                  <FontAwesome
                    name={isFavorited ? "heart" : "heart-o"}
                    size={24}
                    color={isFavorited ? "#feff5f" : "#ccc"}
                  />
                </StyledButton>
              </View>
              <View style={dynamicStyles.metaContainer}>
                <ThemedText style={dynamicStyles.metaText}>{detail.year}</ThemedText>
                <ThemedText style={dynamicStyles.metaText}>{detail.type_name}</ThemedText>
              </View>
              {/* 哔哩哔哩TV版形式：醒目的立即播放大按钮，默认焦点 */}
              <StyledButton
                text="立即播放"
                variant="primary"
                hasTVPreferredFocus
                onPress={() => handlePlay(0)}
                style={dynamicStyles.playNowButton}
                textStyle={dynamicStyles.playNowText}
              />
              <ScrollView style={dynamicStyles.descriptionScrollView}>
                <ThemedText style={dynamicStyles.description}>{detail.desc}</ThemedText>
              </ScrollView>
            </View>
          </View>

          <View style={dynamicStyles.bottomContainer}>
            <View style={dynamicStyles.sourcesContainer}>
              <View style={dynamicStyles.sourcesTitleContainer}>
                <ThemedText style={dynamicStyles.sourcesTitle}>选择播放源 共 {searchResults.length} 个</ThemedText>
                {!allSourcesLoaded && <ActivityIndicator style={{ marginLeft: 10 }} />}
              </View>
              <View style={dynamicStyles.currentSourceRow}>
                <ThemedText numberOfLines={1} style={dynamicStyles.currentSourceName}>
                  {detail?.source_name || "加载中"}
                  {detail?.resolution ? ` · ${detail.resolution}` : ""}
                </ThemedText>
                <StyledButton
                  text="切换源"
                  variant="primary"
                  onPress={() => setShowSourcePicker(true)}
                  style={dynamicStyles.switchSourceButton}
                  textStyle={dynamicStyles.switchSourceButtonText}
                />
              </View>
            </View>
            <View style={dynamicStyles.episodesContainer}>
              <ThemedText style={dynamicStyles.episodesTitle}>播放列表</ThemedText>
              <ScrollView contentContainerStyle={dynamicStyles.episodeList}>
                {displayedEpisodes.map((episode, index) => (
                  <StyledButton
                    key={index}
                    style={dynamicStyles.episodeButton}
                    onPress={() => handlePlay(index)}
                    text={`第 ${index + 1} 集`}
                    textStyle={dynamicStyles.episodeButtonText}
                  />
                ))}
                {detail.episodes.length > EPISODE_LIMIT && (
                  <StyledButton
                    text={episodesExpanded ? "收起剧集" : `展开全部 ${detail.episodes.length} 集`}
                    variant="ghost"
                    onPress={() => setEpisodesExpanded(!episodesExpanded)}
                    style={dynamicStyles.expandButton}
                    textStyle={dynamicStyles.expandButtonText}
                  />
                )}
              </ScrollView>
            </View>
          </View>
        </ScrollView>
      );
    }
  };

  const content = (
    <ThemedView style={[commonStyles.container, { paddingTop: deviceType === 'tv' ? 40 : 0 }]}>
      {renderDetailContent()}
      {renderSourcePicker()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title={detail?.title || "详情"} showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    width: "86%",
    maxHeight: "78%",
    backgroundColor: "#1a1d24",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 20,
  },
  contentTV: {
    width: 760,
    padding: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  closeButton: {
    minHeight: 44,
  },
  speedButton: {
    minHeight: 48,
    marginBottom: 10,
  },
  pickerButtonText: {
    fontSize: 15,
  },
  hintText: {
    color: "#aaaaaa",
    fontSize: 14,
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 12,
  },
  sourceItem: {
    minHeight: 52,
    marginBottom: 8,
  },
  sourceItemText: {
    fontSize: 15,
  },
});

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isTV = deviceType === 'tv';
  const isTablet = deviceType === 'tablet';
  const isMobile = deviceType === 'mobile';

  return StyleSheet.create({
    scrollContainer: {
      flex: 1,
    },
    
    // 移动端专用样式
    mobileTopContainer: {
      paddingHorizontal: spacing,
      paddingTop: spacing,
      paddingBottom: spacing / 2,
    },
    mobilePoster: {
      width: '100%',
      height: 280,
      borderRadius: 8,
      alignSelf: 'center',
      marginBottom: spacing,
    },
    mobileInfoContainer: {
      flex: 1,
    },
    descriptionContainer: {
      paddingHorizontal: spacing,
      paddingBottom: spacing,
    },

    // 平板和TV端样式
    topContainer: {
      flexDirection: "row",
      padding: spacing,
      // TV overscan 安全区
      paddingHorizontal: isTV ? 48 : spacing,
      paddingTop: isTV ? 48 : spacing,
    },
    poster: {
      width: isTV ? 240 : 160,
      height: isTV ? 360 : 240,
      borderRadius: 8,
    },
    infoContainer: {
      flex: 1,
      marginLeft: spacing,
      justifyContent: "flex-start",
    },
    descriptionScrollView: {
      height: isTV ? 200 : 150,
    },

    // 通用样式
    titleContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    title: {
      paddingTop: 16,
      fontSize: isMobile ? 20 : isTablet ? 24 : 34,
      fontWeight: "bold",
      flexShrink: 1,
      color: 'white',
    },
    favoriteButton: {
      padding: 10,
      marginLeft: 10,
      backgroundColor: "transparent",
    },
    metaContainer: {
      flexDirection: "row",
      marginBottom: spacing / 2,
    },
    metaText: {
      color: "#aaa",
      marginRight: spacing / 2,
      fontSize: isTV ? 18 : isMobile ? 12 : 14,
    },
    playNowButton: {
      minHeight: isTV ? 64 : 48,
      paddingHorizontal: isTV ? 40 : 24,
      alignSelf: "flex-start",
      marginTop: isTV ? 8 : 4,
      marginBottom: spacing / 2,
    },
    playNowText: {
      fontSize: isTV ? 20 : 16,
      fontWeight: "bold",
    },
    expandButton: {
      minHeight: isTV ? 56 : 40,
      alignSelf: "flex-start",
      marginTop: 8,
    },
    expandButtonText: {
      fontSize: isTV ? 16 : 14,
      color: "#aaaaaa",
    },
    speedPanel: {
      marginTop: 10,
      backgroundColor: "rgba(255, 255, 255, 0.05)",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.1)",
      padding: isTV ? 18 : 12,
    },
    speedHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    speedTitle: {
      fontSize: isTV ? 19 : 16,
      fontWeight: "bold",
      color: "white",
    },
    speedButton: {
      minHeight: isTV ? 52 : 38,
    },
    speedButtonText: {
      fontSize: isTV ? 15 : 13,
    },
    speedRunningText: {
      color: "#aaaaaa",
      fontSize: isTV ? 15 : 13,
      marginTop: 6,
    },
    speedRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 6,
    },
    speedRankText: {
      color: "#888888",
      fontSize: isTV ? 15 : 13,
      width: isTV ? 28 : 22,
    },
    speedNameText: {
      flex: 1,
      color: "white",
      fontSize: isTV ? 16 : 14,
    },
    speedMsText: {
      color: "#cccccc",
      fontSize: isTV ? 15 : 13,
      marginLeft: 8,
    },
    speedMsFast: {
      color: "#00bb5e",
      fontSize: isTV ? 15 : 13,
      fontWeight: "bold",
      marginLeft: 8,
    },
    speedMsTimeout: {
      color: "#ff6b6b",
      fontSize: isTV ? 15 : 13,
      marginLeft: 8,
    },
    speedSwitchButton: {
      marginTop: 12,
      minHeight: isTV ? 56 : 44,
    },
    currentSourceRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 4,
    },
    currentSourceName: {
      flex: 1,
      fontSize: isTV ? 22 : 17,
      fontWeight: "bold",
      color: "white",
      marginRight: 12,
    },
    switchSourceButton: {
      minHeight: isTV ? 56 : 44,
    },
    switchSourceButtonText: {
      fontSize: isTV ? 16 : 14,
      fontWeight: "bold",
    },
    description: {
      fontSize: isTV ? 18 : isMobile ? 13 : 14,
      color: "#ccc",
      lineHeight: isTV ? 28 : isMobile ? 18 : 22,
    },

    // 播放源和剧集样式
    bottomContainer: {
      paddingHorizontal: isTV ? 48 : spacing,
      paddingBottom: isTV ? 48 : spacing * 2,
    },
    sourcesContainer: {
      marginTop: spacing,
    },
    sourcesTitleContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    sourcesTitle: {
      fontSize: isMobile ? 16 : isTablet ? 18 : 26,
      fontWeight: "bold",
      color: 'white',
    },
    sourceList: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    sourceButton: {
      margin: isMobile ? 4 : 8,
      minHeight: isMobile ? 36 : isTV ? 56 : 44,
    },
    sourceButtonText: {
      color: "white",
      fontSize: isTV ? 18 : isMobile ? 14 : 16,
    },
    badge: {
      backgroundColor: "#666",
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginLeft: 8,
    },
    badgeText: {
      color: "#fff",
      fontSize: isMobile ? 10 : 12,
      fontWeight: "bold",
      paddingBottom: 2.5,
    },
    selectedBadge: {
      backgroundColor: "#4c4c4c",
    },

    episodesContainer: {
      marginTop: spacing,
      paddingBottom: spacing * 2,
    },
    episodesTitle: {
      fontSize: isMobile ? 16 : isTablet ? 18 : 26,
      fontWeight: "bold",
      marginBottom: spacing / 2,
      color: 'white',
    },
    episodeList: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    episodeButton: {
      margin: isTV ? 8 : isMobile ? 3 : 5,
      minHeight: isMobile ? 32 : isTV ? 52 : 36,
      minWidth: isTV ? 96 : undefined,
    },
    episodeButtonText: {
      color: "white",
      fontSize: isTV ? 17 : isMobile ? 12 : 14,
    },
  });
};
