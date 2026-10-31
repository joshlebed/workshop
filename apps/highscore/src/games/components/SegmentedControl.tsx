// Segmented pill switch (the Add-game screen's Friends / Catalog tabs).
// Generic over the item keys; sentence-case labels; `accessibilityRole="tab"`.

import { haptics, homeLayout, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

export interface SegmentedItem<K extends string> {
  key: K;
  label: string;
}

interface SegmentedControlProps<K extends string> {
  items: readonly SegmentedItem<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
}

export function SegmentedControl<K extends string>({
  items,
  value,
  onChange,
  testID = "segmented-control",
}: SegmentedControlProps<K>) {
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.track} accessibilityRole="tablist">
        {items.map((item) => {
          const active = item.key === value;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              testID={`${testID}-${item.key}`}
              onPress={() => {
                if (active) return;
                haptics.selection();
                onChange(item.key);
              }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.segment,
                active && styles.segmentActive,
                !active && (pressed || hovered) && styles.segmentHover,
              ]}
            >
              <Text
                variant="label"
                numberOfLines={1}
                style={[styles.label, active ? styles.labelActive : styles.labelIdle]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: tokens.space.sm,
  },
  track: {
    flexDirection: "row",
    padding: 3,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.pill,
  },
  segmentActive: { backgroundColor: tokens.bg.elevated },
  segmentHover: { backgroundColor: `${tokens.text.primary}0A` },
  label: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  labelActive: { color: tokens.text.primary },
  labelIdle: { color: tokens.text.secondary },
});
