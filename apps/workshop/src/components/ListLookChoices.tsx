import {
  haptics,
  Icon,
  interaction,
  type ListColorKey,
  type PressState,
  Text,
  tokens,
  webSpaceKey,
} from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * A list's look, picked the same way when creating a list (Customize) and in
 * list settings (UX pass 5): one radio group of emoji, one of colors. Selection
 * is shown by a ring and a check, never by color alone; picking gives a
 * selection haptic; every choice is a 44pt target with hover and focus.
 */
export function EmojiChoices({
  choices,
  value,
  onChange,
  testIDPrefix,
}: {
  choices: readonly string[];
  value: string;
  onChange: (emoji: string) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.row} role="radiogroup" aria-label="Emoji">
      {choices.map((choice) => {
        const selected = choice === value;
        const pick = () => {
          if (selected) return;
          haptics.selection();
          onChange(choice);
        };
        return (
          <Pressable
            key={choice}
            role="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`Emoji ${choice}`}
            onPress={pick}
            {...webSpaceKey(pick)}
            style={({ pressed, hovered }: PressState) => [
              styles.emojiCell,
              hovered && styles.hovered,
              pressed && styles.pressed,
              selected && styles.emojiSelected,
            ]}
            testID={testIDPrefix ? `${testIDPrefix}-emoji-${choice}` : undefined}
          >
            <Text style={styles.emojiGlyph}>{choice}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ColorChoices({
  choices,
  value,
  onChange,
  testIDPrefix,
}: {
  choices: readonly ListColorKey[];
  value: string;
  onChange: (color: ListColorKey) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={[styles.row, styles.colorRow]} role="radiogroup" aria-label="Color">
      {choices.map((key) => {
        const selected = key === value;
        const pick = () => {
          if (selected) return;
          haptics.selection();
          onChange(key);
        };
        return (
          <Pressable
            key={key}
            role="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`Color ${key}`}
            onPress={pick}
            {...webSpaceKey(pick)}
            style={({ pressed, hovered }: PressState) => [
              styles.colorTarget,
              hovered && styles.hovered,
              pressed && styles.pressed,
            ]}
            testID={testIDPrefix ? `${testIDPrefix}-color-${key}` : undefined}
          >
            <View style={[styles.swatchRing, selected && styles.swatchRingSelected]}>
              <View style={[styles.swatch, { backgroundColor: tokens.list[key] }]}>
                {selected ? <Icon name="check" size={16} tone="onAccent" /> : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const SWATCH = 28;

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.xs },
  // Pull the 44pt targets out so the first swatch lines up with the gutter.
  colorRow: { marginLeft: -(tokens.hit - SWATCH) / 2 },
  hovered: { backgroundColor: interaction.hover },
  pressed: { backgroundColor: interaction.pressed },
  emojiCell: {
    width: tokens.hit,
    height: tokens.hit,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  emojiSelected: { borderColor: tokens.accent.default, backgroundColor: tokens.accent.muted },
  // lineHeight pinned so the glyph isn't clipped to the body line box on iOS.
  emojiGlyph: { fontSize: tokens.font.size.lg, lineHeight: tokens.font.lineHeight.lg },
  colorTarget: {
    width: tokens.hit,
    height: tokens.hit,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchRing: {
    padding: tokens.space.xxs,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchRingSelected: { borderColor: tokens.text.primary },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
