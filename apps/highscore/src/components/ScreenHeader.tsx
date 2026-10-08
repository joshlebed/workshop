import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { IconButton, PixelIcon, Text, tokens } from "../theme";

interface ScreenHeaderProps {
  /** Pixel-face title; omit when `left` carries the wordmark. */
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  backTestID?: string;
}

/** One header shape for every pushed screen: back key, title, trailing keys. */
export function ScreenHeader({ title, left, right, onBack, backTestID }: ScreenHeaderProps) {
  return (
    <View style={styles.root}>
      {onBack ? (
        <IconButton accessibilityLabel="Back" onPress={onBack} testID={backTestID}>
          <PixelIcon name="arrow-left" color={tokens.text.primary} />
        </IconButton>
      ) : null}
      {left}
      {title ? (
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      ) : (
        <View style={styles.spacer} />
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.md,
    minHeight: 52,
  },
  title: { flex: 1, fontSize: 14, lineHeight: 22 },
  spacer: { flex: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
});
