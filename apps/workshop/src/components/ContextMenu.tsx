import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

interface Props {
  visible: boolean;
  anchor: { x: number; y: number } | null;
  completed: boolean;
  onDismiss: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MENU_W = 200;
const MENU_H = 156;

export function ContextMenu({
  visible,
  anchor,
  completed,
  onDismiss,
  onToggleComplete,
  onEdit,
  onDelete,
}: Props) {
  if (!anchor) return null;
  const { width, height } = Dimensions.get("window");
  const x = Math.max(8, Math.min(anchor.x - MENU_W + 20, width - MENU_W - 8));
  const y = Math.min(anchor.y + 10, height - MENU_H - 20);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <View style={[styles.menu, { left: x, top: y }]} onStartShouldSetResponder={() => true}>
          <MenuItem
            icon={completed ? "✓" : "○"}
            iconColor={completed ? theme.green : theme.textMuted}
            label={completed ? "Mark Incomplete" : "Mark Complete"}
            onPress={onToggleComplete}
          />
          <View style={styles.divider} />
          <MenuItem icon="✎" iconColor={theme.text} label="Edit" onPress={onEdit} />
          <View style={styles.divider} />
          <MenuItem
            icon="🗑"
            iconColor={theme.red}
            labelColor={theme.red}
            label="Delete"
            onPress={onDelete}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function MenuItem({
  icon,
  iconColor,
  label,
  labelColor,
  onPress,
}: {
  icon: string;
  iconColor: string;
  label: string;
  labelColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Text style={[styles.icon, { color: iconColor }]}>{icon}</Text>
      <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "transparent" },
  menu: {
    position: "absolute",
    width: MENU_W,
    backgroundColor: theme.bgElev,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  itemPressed: { backgroundColor: theme.bgElev2 },
  icon: { fontSize: 16, width: 18, textAlign: "center" },
  label: { color: theme.text, fontSize: 15, fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginHorizontal: 8 },
});
