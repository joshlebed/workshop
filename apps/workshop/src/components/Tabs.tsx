import type { RecCategory } from "@workshop/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { completionLabels, theme } from "./theme";

interface Props {
  category: RecCategory;
  active: "incomplete" | "completed";
  onChange: (tab: "incomplete" | "completed") => void;
  counts: { incomplete: number; completed: number };
}

export function Tabs({ category, active, onChange, counts }: Props) {
  const labels = completionLabels[category];
  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => onChange("incomplete")}
        style={({ pressed }) => [
          styles.tab,
          active === "incomplete" && styles.tabActive,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.label, active === "incomplete" && styles.labelActive]}>
          {labels.incomplete}
        </Text>
        <View style={[styles.badge, active === "incomplete" && styles.badgeActive]}>
          <Text style={[styles.badgeText, active === "incomplete" && styles.badgeTextActive]}>
            {counts.incomplete}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onChange("completed")}
        style={({ pressed }) => [
          styles.tab,
          active === "completed" && styles.tabActive,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.label, active === "completed" && styles.labelActive]}>
          {labels.completed}
        </Text>
        <View style={[styles.badge, active === "completed" && styles.badgeActive]}>
          <Text style={[styles.badgeText, active === "completed" && styles.badgeTextActive]}>
            {counts.completed}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.bgElev,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 8,
  },
  tabActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  pressed: { opacity: 0.85 },
  label: { color: theme.textMuted, fontWeight: "600", fontSize: 14 },
  labelActive: { color: theme.text },
  badge: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.bgElev2,
    alignItems: "center",
  },
  badgeActive: { backgroundColor: theme.accent },
  badgeText: { color: theme.textMuted, fontSize: 12, fontWeight: "700" },
  badgeTextActive: { color: "#fff" },
});
