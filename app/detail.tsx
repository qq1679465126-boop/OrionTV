import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, ScrollView, ActivityIndicator } from "react-native";
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

  const handlePlay = (episodeIndex: number) => {
    if (!detail) return;
    abort(); // Cancel any ongoing fetches
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

  // 折叠功能：来源和剧集较多时默认只显示一部分，可展开全部
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [episodesExpanded, setEpisodesExpanded] = useState(false);
  const SOURCE_LIMIT = 6;
  const EPISODE_LIMIT = 30;
  const displayedSources = sourcesExpanded ? searchResults : searchResults.slice(0, SOURCE_LIMIT);
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
    rank?: number;
  }
  const [speedTest, setSpeedTest] = useState<{
    status: "running" | "done";
    progress: number;
    total: number;
    results: SpeedResult[];
  } | null>(null);

  const runSpeedTest = useCallback(async () => {
    const targets = searchResults;
    if (targets.length === 0) return;
    setSpeedTest({ status: "running", progress: 0, total: targets.length, results: [] });

    let completed = 0;
    const results: SpeedResult[] = [];

    const tests = targets.map(async (item) => {
      const m3u8 = item.episodes?.[0];
      let ms: number | null = null;
      if (m3u8) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const t0 = Date.now();
        try {
          const resp = await fetch(m3u8, {
            headers: { Range: "bytes=0-65535" },
            signal: ctrl.signal,
          });
          await resp.text();
          ms = Date.now() - t0;
        } catch {
          ms = null;
        } finally {
          clearTimeout(timer);
        }
      }
      completed += 1;
      const result: SpeedResult = { source: item.source, sourceName: item.source_name, ms };
      results.push(result);
      setSpeedTest((s) =>
        s && s.status === "running"
          ? { ...s, progress: completed, results: [...s.results, result] }
          : s
      );
    });

    await Promise.all(tests);

    results.sort((a, b) => (a.ms ?? 99999) - (b.ms ?? 99999));
    setSpeedTest({
      status: "done",
      progress: targets.length,
      total: targets.length,
      results: results.map((r, i) => ({ ...r, rank: i + 1 })),
    });
  }, [searchResults]);

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
              <ThemedText style={dynamicStyles.speedRankText}>{r.rank}</ThemedText>
              <ThemedText numberOfLines={1} style={dynamicStyles.speedNameText}>
                {r.sourceName}
                {detail?.source === r.source ? "（使用中）" : ""}
              </ThemedText>
              <ThemedText
                style={
                  r.ms === null
                    ? dynamicStyles.speedMsTimeout
                    : r.rank === 1
                      ? dynamicStyles.speedMsFast
                      : dynamicStyles.speedMsText
                }
              >
                {r.ms === null ? "超时" : `${r.ms}ms${r.rank === 1 ? " ⚡最快" : ""}`}
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

          {/* 播放源 */}
          <View style={dynamicStyles.sourcesContainer}>
            <View style={dynamicStyles.sourcesTitleContainer}>
              <ThemedText style={dynamicStyles.sourcesTitle}>播放源 ({searchResults.length})</ThemedText>
              {!allSourcesLoaded && <ActivityIndicator style={{ marginLeft: 10 }} />}
            </View>
            <View style={dynamicStyles.sourceList}>
              {displayedSources.map((item, index) => {
                const isSelected = detail?.source === item.source;
                return (
                  <StyledButton
                    key={index}
                    onPress={() => setDetail(item)}
                    isSelected={isSelected}
                    style={dynamicStyles.sourceButton}
                  >
                    <ThemedText style={dynamicStyles.sourceButtonText}>{item.source_name}</ThemedText>
                    {item.episodes.length > 1 && (
                      <View style={[dynamicStyles.badge, isSelected && dynamicStyles.selectedBadge]}>
                        <Text style={dynamicStyles.badgeText}>
                          {item.episodes.length > 99 ? "99+" : `${item.episodes.length}`} 集
                        </Text>
                      </View>
                    )}
                    {item.resolution && (
                      <View style={[dynamicStyles.badge, { backgroundColor: "#666" }, isSelected && dynamicStyles.selectedBadge]}>
                        <Text style={dynamicStyles.badgeText}>{item.resolution}</Text>
                      </View>
                    )}
                  </StyledButton>
                );
              })}
            </View>
            {searchResults.length > SOURCE_LIMIT && (
              <StyledButton
                text={sourcesExpanded ? "收起来源" : `展开全部 ${searchResults.length} 个来源`}
                variant="ghost"
                onPress={() => setSourcesExpanded(!sourcesExpanded)}
                style={dynamicStyles.expandButton}
                textStyle={dynamicStyles.expandButtonText}
              />
            )}
            {renderSpeedTest()}
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
              <View style={dynamicStyles.sourceList}>
                {displayedSources.map((item, index) => {
                  const isSelected = detail?.source === item.source;
                  return (
                    <StyledButton
                      key={index}
                      onPress={() => setDetail(item)}
                      isSelected={isSelected}
                      style={dynamicStyles.sourceButton}
                    >
                      <ThemedText style={dynamicStyles.sourceButtonText}>{item.source_name}</ThemedText>
                      {item.episodes.length > 1 && (
                        <View style={[dynamicStyles.badge, isSelected && dynamicStyles.selectedBadge]}>
                          <Text style={dynamicStyles.badgeText}>
                            {item.episodes.length > 99 ? "99+" : `${item.episodes.length}`} 集
                          </Text>
                        </View>
                      )}
                      {item.resolution && (
                        <View style={[dynamicStyles.badge, { backgroundColor: "#666" }, isSelected && dynamicStyles.selectedBadge]}>
                          <Text style={dynamicStyles.badgeText}>{item.resolution}</Text>
                        </View>
                      )}
                    </StyledButton>
                  );
                })}
              </View>
              {searchResults.length > SOURCE_LIMIT && (
                <StyledButton
                  text={sourcesExpanded ? "收起来源" : `展开全部 ${searchResults.length} 个来源`}
                  variant="ghost"
                  onPress={() => setSourcesExpanded(!sourcesExpanded)}
                  style={dynamicStyles.expandButton}
                  textStyle={dynamicStyles.expandButtonText}
                />
              )}
              {renderSpeedTest()}
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
