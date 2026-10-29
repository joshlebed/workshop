// The Games-home view switch: My games (your ordered list of today's
// leaderboards, the default) / Friends (which of your friends play what) /
// All games (everything on the platform, most played first). The two catalog
// views are browse-and-add surfaces grouped by game type; only "My games"
// shows standings. A segmented pill under the header, sentence-case labels.

import { haptics, homeLayout, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

export const HOME_VIEWS = [
  { key: "mine", label: "My games" },
  { key: "friends", label: "Friends" },
  { key: "all", label: "All games" },
] as const;

export type HomeView = (typeof HOME_VIEWS)[number]["key"];

interface HomeViewSwitchProps {
  value: HomeView;
  onChange: (view: HomeView) => void;
}

export function HomeViewSwitch({ value, onChange }: HomeViewSwitchProps) {
  return (
    <View style={styles.wrap} testID="home-view-switch">
      <View style={styles.track} accessibilityRole="tablist">
        {HOME_VIEWS.map((view) => {
          const active = view.key === value;
          return (
            <Pressable
              key={view.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={view.label}
              testID={`home-view-${view.key}`}
              onPress={() => {
                if (active) return;
                haptics.selection();
                onChange(view.key);
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
                {view.label}
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
