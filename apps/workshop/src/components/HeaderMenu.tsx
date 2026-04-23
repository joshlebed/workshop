import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

export type HeaderPanel = "paste" | "importCsv" | "exportCsv";

interface Props {
  onSelect: (panel: HeaderPanel) => void;
  onSignOut: () => void;
}

export function HeaderMenu({ onSelect, onSignOut }: Props) {
  return (
    <View style={styles.menu}>
      <MenuItem label="Paste List" onPress={() => onSelect("paste")} />
      <View style={styles.divider} />
      <MenuItem label="Import from CSV" onPress={() => onSelect("importCsv")} />
      <View style={styles.divider} />
      <MenuItem label="Export to CSV" onPress={() => onSelect("exportCsv")} />
      <View style={styles.divider} />
      <MenuItem label="Sign out" onPress={onSignOut} danger />
    </View>
  );
}

function MenuItem({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <Text style={[styles.label, danger ? { color: theme.red } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    top: 58,
    right: 12,
    width: 220,
    backgroundColor: theme.bgElev,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    zIndex: 50,
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pressed: { backgroundColor: theme.bgElev2 },
  label: { color: theme.text, fontSize: 15, fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginHorizontal: 8 },
});
