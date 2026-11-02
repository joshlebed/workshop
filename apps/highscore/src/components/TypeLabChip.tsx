// Review-only floating switcher for the type lab (see src/theme/typeLab.ts).
// Deleted with it once the secondary face is decided.
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  LAB_FONT_LABEL,
  type LabButtons,
  type LabFont,
  type LabScores,
  setTypeLab,
  Text,
  tokens,
  useTypeLab,
} from "../theme";

const FONTS: LabFont[] = ["system", "grotesk", "inter", "plex"];
const SCORES: { key: LabScores; label: string }[] = [
  { key: "pixel", label: "Pixel" },
  { key: "tabular", label: "Tabular" },
];
const BUTTONS: { key: LabButtons; label: string }[] = [
  { key: "secondary", label: "Secondary" },
  { key: "pixel", label: "Pixel" },
];

function Opt({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.opt, on && styles.optOn]}
      accessibilityRole="button"
    >
      <Text variant="caption" tone={on ? "onAccent" : "primary"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TypeLabChip() {
  const lab = useTypeLab();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 84 }]}>
      {open ? (
        <View style={styles.panel}>
          <Text variant="caption" tone="secondary">
            SECONDARY FACE
          </Text>
          <View style={styles.row}>
            {FONTS.map((f) => (
              <Opt
                key={f}
                label={LAB_FONT_LABEL[f]}
                on={lab.font === f}
                onPress={() => setTypeLab({ font: f })}
              />
            ))}
          </View>
          <Text variant="caption" tone="secondary">
            SCORES
          </Text>
          <View style={styles.row}>
            {SCORES.map((o) => (
              <Opt
                key={o.key}
                label={o.label}
                on={lab.scores === o.key}
                onPress={() => setTypeLab({ scores: o.key })}
              />
            ))}
          </View>
          <Text variant="caption" tone="secondary">
            BUTTONS
          </Text>
          <View style={styles.row}>
            {BUTTONS.map((o) => (
              <Opt
                key={o.key}
                label={o.label}
                on={lab.buttons === o.key}
                onPress={() => setTypeLab({ buttons: o.key })}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Type lab"
        style={styles.chip}
        testID="type-lab-chip"
      >
        <Text variant="label" tone="onAccent">
          Aa
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", right: 12, alignItems: "flex-end", gap: 8, zIndex: 50 },
  chip: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.yellow,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  panel: {
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    padding: 10,
    gap: 6,
    maxWidth: 300,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  opt: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  optOn: { backgroundColor: tokens.neon.pink, borderColor: tokens.neon.pink },
});
