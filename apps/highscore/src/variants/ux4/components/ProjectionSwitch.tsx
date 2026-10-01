// The projection switch. Today's data has two readings — down the games or
// across the players — and this flips between them in place instead of pushing
// a screen. Two welded cells sharing one bezel; the live cell is lit.
//
// The bottom panel's middle key is FRIENDS, not PLAYERS, precisely so this
// switch can own the word: here PLAYERS means "group today's scores by person",
// there FRIENDS means the social graph. Two controls reading "PLAYERS" that go
// to different places is the kind of collision nobody forgives.

import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { glow, pixelType, tokens } from "../theme";

export type Projection = "game" | "player";

const OPTIONS: { id: Projection; label: string; hint: string }[] = [
  { id: "game", label: "Games", hint: "Group today by game — standings per game" },
  { id: "player", label: "Players", hint: "Group today by player — every player's day" },
];

interface ProjectionSwitchProps {
  value: Projection;
  onChange: (next: Projection) => void;
}

export function ProjectionSwitch({ value, onChange }: ProjectionSwitchProps) {
  return (
    <View style={styles.frame} testID="projection-switch">
      {OPTIONS.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.hint}
            testID={`projection-${option.id}`}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [
              styles.cell,
              active && styles.cellActive,
              pressed && !active && styles.cellPressed,
            ]}
          >
            <RNText style={[styles.label, active && styles.labelActive]}>{option.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flexDirection: "row" },
  cell: {
    paddingHorizontal: tokens.space.sm,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    marginLeft: -tokens.bezel,
  },
  cellActive: {
    borderColor: tokens.neon.pink,
    backgroundColor: tokens.bg.surface,
    zIndex: 1,
    ...glow(tokens.neon.pinkGlow, 8),
  },
  cellPressed: { backgroundColor: tokens.bg.elevated },
  label: { ...pixelType(10, 1.4), color: tokens.text.secondary },
  labelActive: { color: tokens.neon.pinkTint },
});
