import { useState, useEffect, useCallback } from "react";
import { ResizeMode } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ScreenFitKind = "point" | "live";

const KEY_PREFIX = "screen_resize_mode_";

export const FIT_OPTIONS: { mode: ResizeMode; label: string }[] = [
  { mode: ResizeMode.CONTAIN, label: "适应（保留黑边）" },
  { mode: ResizeMode.COVER, label: "裁切全屏" },
  { mode: ResizeMode.STRETCH, label: "拉伸全屏" },
];

export const fitLabel = (mode: ResizeMode) =>
  FIT_OPTIONS.find((o) => o.mode === mode)?.label || "适应";

/**
 * 画面比例适配（点播/直播分别记忆）：
 * 用户切换一次即永久保存，之后每次播放自动应用，等效自动适配投屏屏幕。
 */
export function useScreenFit(kind: ScreenFitKind) {
  const [mode, setMode] = useState<ResizeMode>(ResizeMode.CONTAIN);

  useEffect(() => {
    AsyncStorage.getItem(KEY_PREFIX + kind)
      .then((v) => {
        if (v) setMode(v as ResizeMode);
      })
      .catch(() => {});
  }, [kind]);

  const cycle = useCallback(() => {
    setMode((prev) => {
      const idx = FIT_OPTIONS.findIndex((o) => o.mode === prev);
      const next = FIT_OPTIONS[(idx + 1) % FIT_OPTIONS.length].mode;
      AsyncStorage.setItem(KEY_PREFIX + kind, next).catch(() => {});
      return next;
    });
  }, [kind]);

  return { mode, cycle };
}
