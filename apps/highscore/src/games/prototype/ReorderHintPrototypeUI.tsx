// PROTOTYPE — UI pieces for the reorder-discoverability options. See
// ./reorderHint.ts for the mode list. Delete this directory (and the
// `reorderHint*` props it feeds) once an option is chosen.

import { Chip, Text, tokens } from "@workshop/ui";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { REORDER_HINT_LABELS, REORDER_HINT_MODES, type ReorderHintMode } from "./reorderHint";

interface SwitchProps {
  mode: ReorderHintMode;
  onChange: (mode: ReorderHintMode) => void;
}

/** Chip row at the top of the home: pick which option is live. */
export function ReorderHintSwitch({ mode, onChange }: SwitchProps) {
  return (
    <View style={styles.switchWrap} testID="reorder-hint-switch">
      <Text variant="caption" tone="muted" style={styles.switchLabel}>
        PROTOTYPE · reorder discoverability
      </Text>
      <View style={styles.switchRow}>
        {REORDER_HINT_MODES.map((m) => (
          <Chip
            key={m}
            label={REORDER_HINT_LABELS[m]}
            selected={m === mode}
            onPress={() => onChange(m)}
            testID={`reorder-hint-${m}`}
          />
        ))}
      </View>
    </View>
  );
}

interface CoachProps {
  onDismiss: () => void;
}

/** Option B: one-time inline coach mark above the list. */
export function ReorderCoachMark({ onDismiss }: CoachProps) {
  const gesture =
    Platform.OS === "web" ? "Press and hold a game, then drag" : "Press and hold a game, then drag";
  return (
    <View style={styles.coach} testID="reorder-coach-mark">
      <Text style={styles.coachGlyph}>↕️</Text>
      <View style={styles.coachBody}>
        <Text variant="body" style={styles.coachTitle}>
          Put your favorites first
        </Text>
        <Text variant="caption" tone="muted">
          {gesture} to reorder your games.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        hitSlop={10}
        testID="reorder-coach-dismiss"
        style={({ pressed, hovered }) => [
          styles.coachClose,
          (pressed || hovered) && styles.coachCloseHover,
        ]}
      >
        <Text style={styles.coachCloseGlyph}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Option A: tip line under the menu's move rows. */
export function ReorderMenuTip() {
  return (
    <Text variant="caption" tone="muted" testID="reorder-menu-tip">
      Tip: press and hold a game on the home screen to drag it anywhere.
    </Text>
  );
}

const styles = StyleSheet.create({
  switchWrap: {
    paddingHorizontal: tokens.space.md,
    paddingBottom: tokens.space.sm,
    gap: tokens.space.xs,
  },
  switchLabel: { letterSpacing: 0.4 },
  switchRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.xs },
  coach: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginHorizontal: tokens.space.md,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: `${tokens.accent.default}14`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${tokens.accent.default}55`,
  },
  coachGlyph: { fontSize: 22 },
  coachBody: { flex: 1, gap: 2 },
  coachTitle: { fontWeight: tokens.font.weight.semibold },
  coachClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  coachCloseHover: { backgroundColor: tokens.bg.elevated },
  coachCloseGlyph: { color: tokens.text.muted, fontSize: 14 },
});
