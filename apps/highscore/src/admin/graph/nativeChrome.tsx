// RN counterparts of canvasControls.tsx for the native canvases: a compact
// toggle button row and a legend strip, laid over the graph.

import { Text } from "@workshop/ui";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { GraphPalette } from "./model";

export function ChromeButton({
  label,
  active,
  onPress,
  palette,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  palette: GraphPalette;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      testID={testID}
      style={[
        styles.button,
        {
          borderColor: active ? palette.accent : palette.border,
          backgroundColor: active ? `${palette.accent}22` : palette.surface,
        },
      ]}
    >
      <Text variant="caption" style={{ color: palette.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChromeTop({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.top}
      contentContainerStyle={styles.topContent}
      pointerEvents="box-none"
    >
      {children}
    </ScrollView>
  );
}

export function ChromeLegend({
  items,
  note,
  palette,
}: {
  items: { color: string; label: string; shape?: "dot" | "line" | "dashed" }[];
  note?: string;
  palette: GraphPalette;
}) {
  return (
    <View
      style={[
        styles.legend,
        { backgroundColor: `${palette.surface}E6`, borderColor: palette.border },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.legendRow}
      >
        {items.map((it) => (
          <View key={it.label} style={styles.legendItem}>
            {it.shape === "line" || it.shape === "dashed" ? (
              <View
                style={{
                  width: 16,
                  borderTopWidth: 2,
                  borderColor: it.color,
                  borderStyle: it.shape === "dashed" ? "dashed" : "solid",
                }}
              />
            ) : (
              <View style={[styles.dot, { backgroundColor: it.color }]} />
            )}
            <Text variant="caption" style={{ color: palette.muted }}>
              {it.label}
            </Text>
          </View>
        ))}
      </ScrollView>
      {note ? (
        <Text variant="caption" style={{ color: palette.muted }} numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 6,
  },
  top: { position: "absolute", top: 8, left: 8, right: 8, maxHeight: 34 },
  topContent: { alignItems: "center", paddingRight: 8 },
  legend: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  legendRow: { gap: 12, alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
