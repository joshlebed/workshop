import type { RecCategory } from "@workshop/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { categoryLabels, theme } from "./theme";

const CATEGORIES: RecCategory[] = ["movie", "tv", "book"];

interface Props {
  active: RecCategory;
  onSelect: (c: RecCategory) => void;
}

export function CategoryDropdown({ active, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.menu}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c}
            onPress={() => onSelect(c)}
            style={({ pressed }) => [
              styles.option,
              c === active && styles.optionActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.optionText, c === active && styles.optionTextActive]}>
              {categoryLabels[c]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  menu: {
    backgroundColor: theme.bgElev,
    borderRadius: 14,
    paddingVertical: 6,
    minWidth: 180,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  optionActive: { backgroundColor: theme.accentDim },
  pressed: { opacity: 0.75 },
  optionText: { color: theme.text, fontSize: 16, fontWeight: "500" },
  optionTextActive: { color: theme.accent, fontWeight: "700" },
});
