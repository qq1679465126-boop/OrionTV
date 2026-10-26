import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, FlatList, StyleSheet, ActivityIndicator, Modal, useTVEventHandler, HWEvent, Text, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import LivePlayer from "@/components/LivePlayer";
import { fetchAndParseM3u, getPlayableUrl, Channel } from "@/services/m3u";
import { api } from "@/services/api";
import { ThemedView } from "@/components/ThemedView";
import { StyledButton } from "@/components/StyledButton";
import { useSettingsStore } from "@/stores/settingsStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";

const LIVE_WATCH_HISTORY_KEY = "live_watch_history_v1";

// 分组名清理：去掉装饰符号（如「•游戏「赛事」」→ 游戏·赛事）
const cleanGroupName = (g: string) =>
  (g || "")
    .replace(/•/g, "")
    .replace(/[「」]/g, "·")
    .replace(/·{2,}/g, "·")
    .trim();

const loadWatchHistory = async (): Promise<Channel[]> => {
  try {
    const raw = await AsyncStorage.getItem(LIVE_WATCH_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as Channel[]) : [];
  } catch {
    return [];
  }
};

const saveWatchHistory = async (list: Channel[]) => {
  try {
    await AsyncStorage.setItem(LIVE_WATCH_HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // 忽略存储失败
  }
};

export default function LiveScreen() {
  const { m3uUrl } = useSettingsStore();
  
  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const [channels, setChannels] = useState<Channel[]>([]);
  const [groupedChannels, setGroupedChannels] = useState<Record<string, Channel[]>>({});
  const [channelGroups, setChannelGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");

  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isChannelListVisible, setIsChannelListVisible] = useState(false);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [watchHistory, setWatchHistory] = useState<Channel[]>([]);
  const titleTimer = useRef<NodeJS.Timeout | null>(null);

  const selectedChannelUrl = channels.length > 0 ? getPlayableUrl(channels[currentChannelIndex].url) : null;

  useEffect(() => {
    const loadChannels = async () => {
      setIsLoading(true);
      let parsedChannels: Channel[] = [];

      // 1) 优先加载 LunaTV 网页后台配置的直播源（登录后自动同步，后台加什么这里就有）
      try {
        const sources = await api.getLiveSources();
        if (sources.length > 0) {
          const channelLists = await Promise.all(
            sources.map(async (src) => {
              try {
                // 优先用服务端解析好的频道（服务端缓存，速度快）
                const remote = await api.getLiveChannels(src.key);
                if (remote.length > 0) {
                  return remote.map((ch) => ({
                    id: `${src.key}-${ch.url}`,
                    name: ch.name,
                    url: ch.url,
                    logo: ch.logo || "",
                    group: ch.group || src.name,
                  })) as Channel[];
                }
                // 服务端无缓存时，App 直接拉该源的 M3U 解析
                return await fetchAndParseM3u(src.url);
              } catch {
                return [] as Channel[];
              }
            })
          );
          parsedChannels = channelLists.flat();
        }
      } catch {
        // 后台不可用则走本地配置
      }

      // 2) 回退：本地自定义直播源地址
      if (parsedChannels.length === 0 && m3uUrl) {
        parsedChannels = await fetchAndParseM3u(m3uUrl);
      }

      // 按 URL 去重
      const seen = new Set<string>();
      parsedChannels = parsedChannels.filter((ch) => {
        if (!ch.url || seen.has(ch.url)) return false;
        seen.add(ch.url);
        return true;
      });

      setChannels(parsedChannels);

      const groups: Record<string, Channel[]> = parsedChannels.reduce((acc, channel) => {
        const groupName = cleanGroupName(channel.group) || "其他";
        if (!acc[groupName]) {
          acc[groupName] = [];
        }
        acc[groupName].push(channel);
        return acc;
      }, {} as Record<string, Channel[]>);

      // 观看历史作为第一个分组（最近观看）
      const hist = await loadWatchHistory();
      if (hist.length > 0) {
        setWatchHistory(hist);
        groups["最近观看"] = hist;
      }

      const groupNames = Object.keys(groups);
      const ordered = groupNames.includes("最近观看")
        ? ["最近观看", ...groupNames.filter((g) => g !== "最近观看")]
        : groupNames;
      setGroupedChannels(groups);
      setChannelGroups(ordered);
      setSelectedGroup(ordered[0] || "");

      if (parsedChannels.length > 0) {
        showChannelTitle(parsedChannels[0].name);
      }
      setIsLoading(false);
    };
    loadChannels();
  }, [m3uUrl]);

  const showChannelTitle = (title: string) => {
    setChannelTitle(title);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => setChannelTitle(null), 3000);
  };

  // 记录观看历史（按 url 去重，最新的在前，最多30条）
  const recordWatch = useCallback((channel: Channel) => {
    if (!channel?.url) return;
    setWatchHistory((prev) => {
      const next = [{ ...channel }, ...prev.filter((c) => c.url !== channel.url)].slice(0, 30);
      saveWatchHistory(next);
      return next;
    });
  }, []);

  const handleSelectChannel = (channel: Channel) => {
    // 按 url 匹配（观看历史里的频道用 url 对应回主列表）
    const globalIndex = channels.findIndex((c) => c.url === channel.url);
    if (globalIndex !== -1) {
      setCurrentChannelIndex(globalIndex);
      showChannelTitle(channel.name);
      setIsChannelListVisible(false);
      recordWatch(channel);
    } else {
      // 历史频道当前不在播出列表（如下播了）
      showChannelTitle(`「${channel.name}」当前不在播出列表`);
    }
  };

  const changeChannel = useCallback(
    (direction: "next" | "prev") => {
      if (channels.length === 0) return;
      let newIndex =
        direction === "next"
          ? (currentChannelIndex + 1) % channels.length
          : (currentChannelIndex - 1 + channels.length) % channels.length;
      setCurrentChannelIndex(newIndex);
      showChannelTitle(channels[newIndex].name);
      recordWatch(channels[newIndex]);
    },
    [channels, currentChannelIndex, recordWatch]
  );

  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (deviceType !== 'tv') return;
      if (isChannelListVisible) return;
      if (event.eventType === "down") setIsChannelListVisible(true);
      else if (event.eventType === "left") changeChannel("prev");
      else if (event.eventType === "right") changeChannel("next");
    },
    [changeChannel, isChannelListVisible, deviceType]
  );

  useTVEventHandler(deviceType === 'tv' ? handleTVEvent : () => {});

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  // 搜索：输入非空时在全部频道中按名称查找
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const searchResults = isSearching
    ? channels.filter((c) => (c.name || "").toLowerCase().includes(normalizedQuery))
    : [];
  const displayChannels = isSearching
    ? searchResults
    : groupedChannels[selectedGroup] || [];

  const renderLiveContent = () => (
    <>
      <LivePlayer
        streamUrl={selectedChannelUrl}
        channelTitle={channelTitle}
        onPlaybackStatusUpdate={() => {}}
      />
      <Modal
        animationType="slide"
        transparent={true}
        visible={isChannelListVisible}
        onRequestClose={() => setIsChannelListVisible(false)}
      >
        <View style={dynamicStyles.modalContainer}>
          <View style={dynamicStyles.modalContent}>
            <Text style={dynamicStyles.modalTitle}>选择频道</Text>
            <TextInput
              style={dynamicStyles.searchInput}
              placeholder="搜索频道…"
              placeholderTextColor="#888"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {isSearching && (
              <Text style={dynamicStyles.searchHint}>
                {searchResults.length > 0 ? `找到 ${searchResults.length} 个频道` : "没有找到匹配的频道"}
              </Text>
            )}
            <View style={dynamicStyles.listContainer}>
              <View style={dynamicStyles.groupColumn}>
                <FlatList
                  data={channelGroups}
                  keyExtractor={(item, index) => `group-${item}-${index}`}
                  renderItem={({ item }) => (
                    <StyledButton
                      text={item}
                      onPress={() => {
                        setSearchQuery("");
                        setSelectedGroup(item);
                      }}
                      isSelected={!isSearching && selectedGroup === item}
                      style={dynamicStyles.groupButton}
                      textStyle={dynamicStyles.groupButtonText}
                    />
                  )}
                />
              </View>
              <View style={dynamicStyles.channelColumn}>
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : (
                  <FlatList
                    data={displayChannels}
                    keyExtractor={(item, index) => `${item.id}-${item.group}-${index}`}
                    renderItem={({ item }) => (
                      <StyledButton
                        text={item.name || "Unknown Channel"}
                        onPress={() => handleSelectChannel(item)}
                        isSelected={channels[currentChannelIndex]?.id === item.id}
                        hasTVPreferredFocus={channels[currentChannelIndex]?.id === item.id}
                        style={dynamicStyles.channelItem}
                        textStyle={dynamicStyles.channelItemText}
                      />
                    )}
                  />
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {renderLiveContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === 'tv') {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="直播" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === 'mobile';
  const isTablet = deviceType === 'tablet';
  const isTV = deviceType === 'tv';
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  return StyleSheet.create({
    container: {
      flex: 1,
    },
    modalContainer: {
      flex: 1,
      flexDirection: "row",
      justifyContent: isMobile ? "center" : "flex-end",
      backgroundColor: "transparent",
    },
    modalContent: {
      width: isMobile ? '90%' : isTablet ? 400 : 520,
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.85)",
      padding: isTV ? 40 : spacing,
    },
    modalTitle: {
      color: "white",
      marginBottom: spacing / 2,
      textAlign: "center",
      fontSize: isTV ? 24 : isMobile ? 18 : 16,
      fontWeight: "bold",
    },
    listContainer: {
      flex: 1,
      flexDirection: isMobile ? "column" : "row",
    },
    groupColumn: {
      flex: isMobile ? 0 : 1,
      marginRight: isMobile ? 0 : spacing / 2,
      marginBottom: isMobile ? spacing : 0,
      maxHeight: isMobile ? 120 : undefined,
    },
    channelColumn: {
      flex: isMobile ? 1 : 2,
    },
    groupButton: {
      paddingVertical: isMobile ? minTouchTarget / 4 : 8,
      paddingHorizontal: spacing / 2,
      marginVertical: isMobile ? 2 : 4,
      minHeight: isMobile ? minTouchTarget * 0.7 : isTV ? 56 : undefined,
    },
    groupButtonText: {
      fontSize: isTV ? 17 : isMobile ? 14 : 13,
    },
    channelItem: {
      paddingVertical: isMobile ? minTouchTarget / 5 : 6,
      paddingHorizontal: spacing,
      marginVertical: isMobile ? 2 : 3,
      minHeight: isMobile ? minTouchTarget * 0.8 : isTV ? 60 : undefined,
    },
    channelItemText: {
      fontSize: isTV ? 17 : isMobile ? 14 : 12,
    },
    searchInput: {
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      borderRadius: isTV ? 12 : 8,
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.3)",
      color: "white",
      fontSize: isTV ? 18 : 15,
      paddingHorizontal: isTV ? 20 : 12,
      paddingVertical: isTV ? 14 : 10,
      marginBottom: spacing / 2,
    },
    searchHint: {
      color: "#aaa",
      fontSize: isTV ? 15 : 12,
      marginBottom: spacing / 2,
    },
  });
};
