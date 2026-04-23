import type { RecItem } from "@workshop/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

interface Props {
  item: RecItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onOpenMenu: (anchor: { x: number; y: number }) => void;
}

export function ItemCard({ item, onIncrement, onDecrement, onOpenMenu }: Props) {
  return (
    <View style={[styles.card, item.completed && styles.cardCompleted]}>
      <View style={styles.countPill}>
        <Text style={styles.countText}>{item.count}</Text>
      </View>

      <Text style={[styles.title, item.completed && styles.titleCompleted]} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={styles.actions}>
        <Pressable
          onPress={onDecrement}
          style={({ pressed }) => [styles.arrow, styles.arrowDown, pressed && styles.pressed]}
          hitSlop={6}
          accessibilityLabel="Decrement count"
        >
          <Text style={styles.arrowText}>▼</Text>
        </Pressable>
        <Pressable
          onPress={onIncrement}
          style={({ pressed }) => [styles.arrow, styles.arrowUp, pressed && styles.pressed]}
          hitSlop={6}
          accessibilityLabel="Increment count"
        >
          <Text style={styles.arrowText}>▲</Text>
        </Pressable>
        <Pressable
          onPress={(e) => {
            const { pageX, pageY } = e.nativeEvent;
            onOpenMenu({ x: pageX, y: pageY });
          }}
          style={({ pressed }) => [styles.menuBtn, pressed && styles.pressed]}
          hitSlop={10}
          accessibilityLabel="Item actions"
        >
          <View style={styles.menuDot} />
          <View style={styles.menuDot} />
          <View style={styles.menuDot} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 14,
    backgroundColor: theme.bgElev,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  cardCompleted: { opacity: 0.72 },
  countPill: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: theme.accentDim,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: theme.text, fontSize: 17, fontWeight: "800" },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    fontWeight: "500",
  },
  titleCompleted: { textDecorationLine: "line-through", color: theme.textMuted },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowDown: { backgroundColor: theme.redDim },
  arrowUp: { backgroundColor: theme.greenDim },
  arrowText: { color: theme.text, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.6 },
  menuBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginLeft: 4,
  },
  menuDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.textMuted,
  },
});
