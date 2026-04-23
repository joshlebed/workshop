import type { RecCategory } from "@workshop/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { categoryLabels, theme } from "./theme";

interface Props {
  category: RecCategory;
  onToggleCategoryMenu: () => void;
  onToggleHeaderMenu: () => void;
  categoryMenuOpen: boolean;
}

export function Header({
  category,
  onToggleCategoryMenu,
  onToggleHeaderMenu,
  categoryMenuOpen,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.side} />

      <Pressable
        onPress={onToggleCategoryMenu}
        style={({ pressed }) => [styles.titleBtn, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Text style={styles.title}>
          <Text style={[styles.titleCategory, categoryMenuOpen && styles.titleCategoryActive]}>
            {categoryLabels[category]}
          </Text>
          <Text style={styles.titleSuffix}> Recs</Text>
        </Text>
        <Text style={[styles.caret, categoryMenuOpen && styles.caretOpen]}>▾</Text>
      </Pressable>

      <Pressable
        onPress={onToggleHeaderMenu}
        style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        hitSlop={10}
        accessibilityLabel="More actions"
      >
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    backgroundColor: theme.bg,
  },
  side: { width: 36 },
  titleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  pressed: { opacity: 0.7 },
  title: { fontSize: 22, fontWeight: "700" },
  titleCategory: { color: theme.text },
  titleCategoryActive: { color: theme.accent },
  titleSuffix: { color: theme.text },
  caret: { color: theme.textMuted, fontSize: 16, marginLeft: 6 },
  caretOpen: { color: theme.accent },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.text,
  },
});
