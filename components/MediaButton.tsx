import React, { ComponentProps } from "react";
import { StyledButton } from "./StyledButton";
import { StyleSheet, View, Text } from "react-native";

type StyledButtonProps = ComponentProps<typeof StyledButton> & {
  timeLabel?: string;
};

export const MediaButton = ({ timeLabel, ...props }: StyledButtonProps) => (
  <View>
    <StyledButton {...props} style={[styles.mediaControlButton, props.style]} variant="ghost" />
    {timeLabel && <Text style={styles.timeLabel}>{timeLabel}</Text>}
  </View>
);

const styles = StyleSheet.create({
  mediaControlButton: {
    padding: 16,
    minWidth: 96,
    minHeight: 64,
    justifyContent: "center",
    alignItems: "center",
  },
  timeLabel: {
    position: "absolute",
    top: 10,
    right: 10,
    color: "white",
    fontSize: 13,
    fontWeight: "bold",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 5,
    borderRadius: 3,
  },
});
