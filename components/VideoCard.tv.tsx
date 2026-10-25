import React, { useState, useEffect, useCallback, useRef, forwardRef } from "react";
import { View, Text, Image, StyleSheet, Pressable, TouchableOpacity, Alert, Animated, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Star, Play } from "lucide-react-native";
import { PlayRecordManager } from "@/services/storage";
import { API } from "@/services/api";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import Logger from '@/utils/Logger';
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

const logger = Logger.withTag('VideoCardTV');

interface VideoCardProps extends React.ComponentProps<typeof TouchableOpacity> {
  id: string;
  source: string;
  title: string;
  poster: string;
  year?: string;
  rate?: string;
  sourceName?: string;
  progress?: number; // 播放进度，0-1之间的小数
  playTime?: number; // 播放时间 in ms
  episodeIndex?: number; // 剧集索引
  totalEpisodes?: number; // 总集数
  onFocus?: () => void;
  onRecordDeleted?: () => void; // 添加回调属性
  api: API;
  cardWidth?: number; // 海报宽度（可选，默认176，按屏幕高度自适应时传入）
}

const VideoCard = forwardRef<View, VideoCardProps>(
  (
    {
      id,
      source,
      title,
      poster,
      year,
      rate,
      sourceName,
      progress,
      episodeIndex,
      onFocus,
      onRecordDeleted,
      api,
      playTime = 0,
      cardWidth: cardWidthProp,
    }: VideoCardProps,
    ref
  ) => {
    const router = useRouter();
    const [isFocused, setIsFocused] = useState(false);
    const [fadeAnim] = useState(new Animated.Value(0));

    // 海报宽度：默认 176，高度按 2:3 比例，小屏（投屏模式）自动缩小
    const cardW = Math.round(cardWidthProp ?? CARD_WIDTH);
    const cardH = Math.round(cardW * 1.5);
    const s = React.useMemo(() => createStyles(cardW, cardH), [cardW, cardH]);

    const longPressTriggered = useRef(false);

    const scale = useRef(new Animated.Value(1)).current;

    const deviceType = useResponsiveLayout().deviceType;

    const animatedStyle = {
      transform: [{ scale }],
    };

    const handlePress = () => {
      if (longPressTriggered.current) {
        longPressTriggered.current = false;
        return;
      }
      // 如果有播放进度，直接转到播放页面
      if (progress !== undefined && episodeIndex !== undefined) {
        router.push({
          pathname: "/play",
          params: { source, id, episodeIndex: episodeIndex - 1, title, position: playTime * 1000 },
        });
      } else {
        router.push({
          pathname: "/detail",
          params: { source, q: title },
        });
      }
    };

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      Animated.spring(scale, {
        toValue: 1.08,
        damping: 15,
        stiffness: 200,
        useNativeDriver: true,
      }).start();
      onFocus?.();
    }, [scale, onFocus]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
      Animated.spring(scale, {
        toValue: 1.0,
        useNativeDriver: true,
      }).start();
    }, [scale]);

    useEffect(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: Math.random() * 200, // 随机延迟创造交错效果
        useNativeDriver: true,
      }).start();
    }, [fadeAnim]);

    const handleLongPress = () => {
      // Only allow long press for items with progress (play records)
      if (progress === undefined) return;

      longPressTriggered.current = true;

      // Show confirmation dialog to delete play record
      Alert.alert("删除观看记录", `确定要删除"${title}"的观看记录吗？`, [
        {
          text: "取消",
          style: "cancel",
        },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete from local storage
              await PlayRecordManager.remove(source, id);

              // Call the onRecordDeleted callback
              if (onRecordDeleted) {
                onRecordDeleted();
              }
              // 如果没有回调函数，则使用导航刷新作为备选方案
              else if (router.canGoBack()) {
                router.replace("/");
              }
            } catch (error) {
              logger.info("Failed to delete play record:", error);
              Alert.alert("错误", "删除观看记录失败，请重试");
            }
          },
        },
      ]);
    };

    // 是否是继续观看的视频
    const isContinueWatching = progress !== undefined && progress > 0 && progress < 1;

    return (
      <Animated.View style={[s.wrapper, animatedStyle, { opacity: fadeAnim }]}>
        <Pressable
          android_ripple={Platform.isTV || deviceType !== 'tv' ? { color: 'transparent' } : { color: Colors.dark.link }}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={({ pressed }) => [
            s.pressable,
            {
              zIndex: pressed ? 999 : 1, // 确保按下时有最高优先级
            },
          ]}
          // activeOpacity={1}
          delayLongPress={1000}
        >
          <View style={s.card}>
            <Image source={{ uri: api.getImageProxyUrl(poster) }} style={s.poster} />
            {isFocused && (
              <View style={s.focusBorder} />
            )}
            {isFocused && (
              <View style={s.overlay}>
                {isContinueWatching && (
                  <View style={s.continueWatchingBadge}>
                    <Play size={16} color="#ffffff" fill="#ffffff" />
                    <ThemedText style={s.continueWatchingText}>继续观看</ThemedText>
                  </View>
                )}
              </View>
            )}

            {/* 进度条 */}
            {isContinueWatching && (
              <View style={s.progressContainer}>
                <View style={[s.progressBar, { width: `${(progress || 0) * 100}%` }]} />
              </View>
            )}

            {rate && (
              <View style={s.ratingContainer}>
                <Star size={12} color="#FFD700" fill="#FFD700" />
                <ThemedText style={s.ratingText}>{rate}</ThemedText>
              </View>
            )}
            {year && (
              <View style={s.yearBadge}>
                <Text style={s.badgeText}>{year}</Text>
              </View>
            )}
            {sourceName && (
              <View style={s.sourceNameBadge}>
                <Text style={s.badgeText}>{sourceName}</Text>
              </View>
            )}
          </View>
          <View style={s.infoContainer}>
            <ThemedText numberOfLines={1} style={[s.title, isFocused && s.titleFocused]}>
              {title}
            </ThemedText>
            {isContinueWatching && (
              <View style={s.infoRow}>
                <ThemedText style={s.continueLabel}>
                  第{episodeIndex}集 已观看 {Math.round((progress || 0) * 100)}%
                </ThemedText>
              </View>
            )}
          </View>
        </Pressable>
      </Animated.View>
    );
  }
);

VideoCard.displayName = "VideoCard";

export default VideoCard;

const CARD_WIDTH = 176;

// 海报尺寸动态化：宽度可传入（投屏小屏自动缩小），高度固定 2:3
const createStyles = (w: number, h: number) =>
  StyleSheet.create({
    wrapper: {
      marginHorizontal: 8,
    },
    pressable: {
      width: w + 20,
      height: h + 60,
      justifyContent: "center",
      alignItems: "center",
      overflow: "visible",
    },
    card: {
      marginTop: 10,
      width: w,
      height: h,
      borderRadius: 8,
      backgroundColor: "#222",
      overflow: "hidden",
    },
    poster: {
      width: "100%",
      height: "100%",
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.15)",
      borderRadius: 8,
      justifyContent: "center",
      alignItems: "center",
    },
    focusBorder: {
      ...StyleSheet.absoluteFillObject,
      borderWidth: 4,
      borderColor: "#ffffff",
      borderRadius: 8,
      zIndex: 10,
    },
    buttonRow: {
      position: "absolute",
      top: 8,
      left: 8,
      flexDirection: "row",
      gap: 8,
    },
    iconButton: {
      padding: 4,
    },
    favButton: {
      position: "absolute",
      top: 8,
      left: 8,
    },
    ratingContainer: {
      position: "absolute",
      top: 8,
      right: 8,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    ratingText: {
      color: "#FFD700",
      fontSize: w < 150 ? 11 : 14,
      fontWeight: "bold",
      marginLeft: 4,
    },
    infoContainer: {
      width: w,
      marginTop: 8,
      alignItems: "flex-start",
      marginBottom: 16,
      paddingHorizontal: 4,
    },
    infoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
    },
    title: {
      color: "white",
      fontSize: w < 150 ? 14 : 18,
      fontWeight: "bold",
      textAlign: "center",
    },
    titleFocused: {
      color: Colors.dark.primary,
      fontWeight: "bold",
    },
    yearBadge: {
      position: "absolute",
      top: 8,
      right: 8,
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    sourceNameBadge: {
      position: "absolute",
      top: 8,
      left: 8,
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    badgeText: {
      color: "white",
      fontSize: w < 150 ? 11 : 14,
      fontWeight: "bold",
    },
    progressContainer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 4,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
    },
    progressBar: {
      height: 4,
      backgroundColor: Colors.dark.primary,
    },
    continueWatchingBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.dark.primary,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 5,
    },
    continueWatchingText: {
      color: "white",
      marginLeft: 5,
      fontSize: 12,
      fontWeight: "bold",
    },
    continueLabel: {
      color: Colors.dark.primary,
      fontSize: 12,
    },
  });
