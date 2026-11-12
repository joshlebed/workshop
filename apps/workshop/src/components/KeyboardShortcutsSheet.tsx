import { Sheet, Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { SHORTCUTS } from "../lib/shortcuts/catalog";

/** Key caps for one chord: quiet outlined boxes, the one place they're drawn. */
export function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <View style={styles.keys}>
      {keys.map((k) => (
        <View key={k} style={styles.key}>
          <Text variant="caption" tone="secondary" style={styles.keyText}>
            {k}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface KeyboardShortcutsSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Every web keyboard shortcut in one quiet place (5.7b), opened with `?`
 * anywhere or from Settings. Keys never fire while typing or while a sheet
 * like this one is open.
 */
export function KeyboardShortcutsSheet({ visible, onClose }: KeyboardShortcutsSheetProps) {
  return (
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      accessibilityLabel="Keyboard shortcuts"
      testID="shortcuts-sheet"
    >
      <Text variant="heading" headerRole>
        Keyboard shortcuts
      </Text>
      <View accessibilityRole="list">
        {SHORTCUTS.map((s) => (
          <View
            key={s.id}
            accessibilityRole="none"
            style={styles.row}
            aria-label={`${s.label}: ${s.keys.join(" ")}${s.alt ? ` or ${s.alt.join(" ")}` : ""}`}
          >
            <View style={styles.label}>
              <Text>{s.label}</Text>
              <Text variant="caption" tone="muted">
                {s.where}
              </Text>
            </View>
            <ShortcutKeys keys={s.keys} />
            {s.alt ? (
              <>
                <Text variant="caption" tone="muted">
                  or
                </Text>
                <ShortcutKeys keys={s.alt} />
              </>
            ) : null}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.hit,
    paddingVertical: tokens.space.xsm,
  },
  label: { flex: 1, minWidth: 0 },
  keys: { flexDirection: "row", gap: tokens.space.xs },
  key: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: tokens.space.xsm,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.border.strong,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontWeight: tokens.font.weight.medium },
});
