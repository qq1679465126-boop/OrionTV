import React, { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Alert, Platform, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { StyledButton } from "@/components/StyledButton";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useSettingsStore } from "@/stores/settingsStore";
// import useAuthStore from "@/stores/authStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { APIConfigSection } from "@/components/settings/APIConfigSection";
import { LiveStreamSection } from "@/components/settings/LiveStreamSection";
import { RemoteInputSection } from "@/components/settings/RemoteInputSection";
import { UpdateSection } from "@/components/settings/UpdateSection";
// import { VideoSourceSection } from "@/components/settings/VideoSourceSection";
import Toast from "react-native-toast-message";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

type SectionItem = {
  component: React.ReactElement;
  key: string;
};

/** 过滤掉 false/undefined，帮 TypeScript 推断出真正的数组元素类型 */
function isSectionItem(
  item: false | undefined | SectionItem
): item is SectionItem {
  return !!item;
}

export default function SettingsScreen() {
  const { loadSettings, saveSettings, setApiBaseUrl, setM3uUrl } = useSettingsStore();
  const { lastMessage, targetPage, clearMessage } = useRemoteControlStore();
  const backgroundColor = useThemeColor({}, "background");
  const insets = useSafeAreaInsets();

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSection, setCurrentSection] = useState<string | null>(null);

  const apiSectionRef = useRef<any>(null);
  const liveStreamSectionRef = useRef<any>(null);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (lastMessage && !targetPage) {
      const realMessage = lastMessage.split("_")[0];
      handleRemoteInput(realMessage);
      clearMessage(); // Clear the message after processing
      markAsChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, targetPage]);

  const handleRemoteInput = (message: string) => {
    // Handle remote input based on currently focused section
    if (currentSection === "api" && apiSectionRef.current) {
      // API Config Section
      setApiBaseUrl(message);
    } else if (currentSection === "livestream" && liveStreamSectionRef.current) {
      // Live Stream Section
      setM3uUrl(message);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await saveSettings();
      setHasChanges(false);
      Toast.show({
        type: "success",
        text1: "保存成功",
      });
    } catch {
      Alert.alert("错误", "保存设置失败");
    } finally {
      setIsLoading(false);
    }
  };

  const markAsChanged = () => {
    setHasChanges(true);
  };

  // const sections = [
  //   // 远程输入配置 - 仅在非手机端显示
  //   deviceType !== "mobile" && {
  //     component: (
  //       <RemoteInputSection
  //         onChanged={markAsChanged}
  //         onFocus={() => {
  //           setCurrentFocusIndex(0);
  //           setCurrentSection("remote");
  //         }}
  //       />
  //     ),
  //     key: "remote",
  //   },
  //   {
  //     component: (
  //       <APIConfigSection
  //         ref={apiSectionRef}
  //         onChanged={markAsChanged}
  //         hideDescription={deviceType === "mobile"}
  //         onFocus={() => {
  //           setCurrentFocusIndex(1);
  //           setCurrentSection("api");
  //         }}
  //       />
  //     ),
  //     key: "api",
  //   },
  //   // 直播源配置 - 仅在非手机端显示
  //   deviceType !== "mobile" && {
  //     component: (
  //       <LiveStreamSection
  //         ref={liveStreamSectionRef}
  //         onChanged={markAsChanged}
  //         onFocus={() => {
  //           setCurrentFocusIndex(2);
  //           setCurrentSection("livestream");
  //         }}
  //       />
  //     ),
  //     key: "livestream",
  //   },
  //   // {
  //   //   component: (
  //   //     <VideoSourceSection
  //   //       onChanged={markAsChanged}
  //   //       onFocus={() => {
  //   //         setCurrentFocusIndex(3);
  //   //         setCurrentSection("videoSource");
  //   //       }}
  //   //     />
  //   //   ),
  //   //   key: "videoSource",
  //   // },
  //   Platform.OS === "android" && {
  //     component: <UpdateSection />,
  //     key: "update",
  //   },
  // ].filter(Boolean);
  const rawSections = [
    {
      component: <TVModeSection />,
      key: "tvui",
    },
    deviceType !== "mobile" && {
      component: (
        <RemoteInputSection
          onChanged={markAsChanged}
          onFocus={() => {
            setCurrentSection("remote");
          }}
        />
      ),
      key: "remote",
    },
    {
      component: (
        <APIConfigSection
          ref={apiSectionRef}
          onChanged={markAsChanged}
          hideDescription={deviceType === "mobile"}
          onFocus={() => {
            setCurrentSection("api");
          }}
        />
      ),
      key: "api",
    },
    deviceType !== "mobile" && {
      component: (
        <LiveStreamSection
          ref={liveStreamSectionRef}
          onChanged={markAsChanged}
          onFocus={() => {
            setCurrentSection("livestream");
          }}
        />
      ),
      key: "livestream",
    },
    Platform.OS === "android" && {
      component: <UpdateSection />,
      key: "update",
    },
  ] as const; // 把每个对象都当作字面量保留
  /** 这里得到的 sections 已经是 SectionItem[]（没有 false） */
  const sections: SectionItem[] = rawSections.filter(isSectionItem);

  // TV端焦点导航：直接依赖系统原生 D-pad 焦点引擎，
  // 焦点顺序 = 页面元素顺序（各设置区输入框 → 保存按钮），无需自定义拦截。

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing, insets);

  const renderSettingsContent = () => (
    // <KeyboardAvoidingView style={{ flex: 1, backgroundColor }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <KeyboardAwareScrollView
      enableOnAndroid={true}
      extraScrollHeight={20}
      keyboardOpeningTime={0}
      keyboardShouldPersistTaps="always"
      scrollEnabled={true}
      style={{ flex: 1, backgroundColor }}
    >

      <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
        {deviceType === "tv" && (
          <View style={dynamicStyles.header}>
            <ThemedText style={dynamicStyles.title}>设置</ThemedText>
          </View>
        )}

        {/* <View style={dynamicStyles.scrollView}>
          <FlatList
            data={sections}
            renderItem={({ item }) => {
              if (item) {
                return item.component;
              }
              return null;
            }}
            keyExtractor={(item) => (item ? item.key : "default")}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={dynamicStyles.listContent}
          />
        </View> */}
        <View style={dynamicStyles.scrollView}>
          {sections.map(item => (
            // 必须把 key 放在最外层的 View 上
            <View key={item.key} style={dynamicStyles.itemWrapper}>
              {item.component}
            </View>
          ))}
        </View>

        <View style={dynamicStyles.footer}>
          <StyledButton
            text={isLoading ? "保存中..." : "保存设置"}
            onPress={handleSave}
            variant="primary"
            disabled={!hasChanges || isLoading}
            style={[dynamicStyles.saveButton, (!hasChanges || isLoading) && dynamicStyles.disabledButton]}
          />
        </View>
      </ThemedView>
    </KeyboardAwareScrollView>
    // </KeyboardAvoidingView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === "tv") {
    return renderSettingsContent();
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="设置" showBackButton />
      {renderSettingsContent()}
    </ResponsiveNavigation>
  );
}

// 投屏模式开关：手机/平板投屏到电视时，强制使用电视版大字界面。
// 切换后立即生效并自动保存，无需按"保存设置"。
function TVModeSection() {
  const forcedTVMode = useSettingsStore((s) => s.forcedTVMode);
  const setForcedTVMode = useSettingsStore((s) => s.setForcedTVMode);

  return (
    <View style={tvModeStyles.card}>
      <View style={tvModeStyles.textContent}>
        <ThemedText style={tvModeStyles.title}>电视版界面（投屏模式）</ThemedText>
        <ThemedText style={tvModeStyles.description}>
          用手机/平板投屏到电视时开启，界面立即变成电视版大字布局（多行栏目、大卡片、大按钮）。
          建议手机横屏后投屏。再次关闭可恢复手机版界面。
        </ThemedText>
      </View>
      <Switch
        value={forcedTVMode}
        onValueChange={setForcedTVMode}
        trackColor={{ false: "#444444", true: "#00bb5e" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const tvModeStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    padding: 16,
  },
  textContent: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    color: "white",
    fontSize: 17,
    fontWeight: "bold",
    marginBottom: 4,
  },
  description: {
    color: "#aaaaaa",
    fontSize: 13,
    lineHeight: 19,
  },
});

const createResponsiveStyles = (deviceType: string, spacing: number, insets: any) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";
  const isTV = deviceType === "tv";
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  return StyleSheet.create({
    container: {
      flex: 1,
      padding: spacing,
      paddingTop: isTV ? spacing * 2 : isMobile ? insets.top + spacing : insets.top + spacing * 1.5,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing,
    },
    title: {
      fontSize: isMobile ? 24 : isTablet ? 28 : 32,
      fontWeight: "bold",
      paddingTop: spacing,
      color: "white",
    },
    scrollView: {
      flex: 1,
    },
    listContent: {
      paddingBottom: spacing,
    },
    footer: {
      paddingTop: spacing,
      alignItems: isMobile ? "center" : "flex-end",
    },
    saveButton: {
      minHeight: isMobile ? minTouchTarget : isTablet ? 50 : 56,
      width: isMobile ? "100%" : isTablet ? 140 : 160,
      maxWidth: isMobile ? 280 : undefined,
    },
    disabledButton: {
      opacity: 0.5,
    },
    itemWrapper: {
      marginBottom: spacing,   // 这里的 spacing 来自 useResponsiveLayout()
    },
  });
};
