// The app's bottom bar: three fixed slots, present on the two top-level
// surfaces (scoreboard, friends). PASTE sits in the middle as the one lit
// sign — it is the primary write and the reason the app exists. It reads the
// clipboard (where supported) and lands on the recognise-and-post screen.

import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readClipboardForPaste } from "../games/lib/pasteEntry";
import { glow, PixelIcon, type PixelIconName, Text, tokens } from "../theme";

export type BottomBarTab = "board" | "friends";

export interface BottomBarProps {
  active: BottomBarTab;
  /** Pending inbound friend requests — badges the Friends slot. */
  friendRequests?: number;
}

export const BOTTOM_BAR_HEIGHT = 64;

export function BottomBar({ active, friendRequests = 0 }: BottomBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const onPaste = async () => {
    const text = await readClipboardForPaste();
    const params = text ? `?text=${encodeURIComponent(text)}` : "";
    router.push(`/share/pick-game${params}` as Href);
  };
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]} testID="bottom-bar">
      <Slot
        icon="trophy"
        label="Board"
        active={active === "board"}
        onPress={() => router.navigate("/")}
        testID="bottom-bar-board"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Paste a score"
        onPress={onPaste}
        testID="bottom-bar-paste"
        style={({ pressed }) => [styles.paste, pressed && styles.pastePressed]}
      >
        <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
        <Text variant="heading" tone="link" style={styles.pasteLabel}>
          Paste
        </Text>
      </Pressable>
      <Slot
        icon="users"
        label="Friends"
        active={active === "friends"}
        badge={friendRequests}
        onPress={() => router.navigate("/friends")}
        testID="bottom-bar-friends"
      />
    </View>
  );
}

function Slot({
  icon,
  label,
  active,
  badge = 0,
  onPress,
  testID,
}: {
  icon: PixelIconName;
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
  testID: string;
}) {
  const color = active ? tokens.neon.pink : tokens.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} requests` : label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.slot, pressed && styles.slotPressed]}
    >
      <View>
        <PixelIcon name={icon} size={24} color={color} />
        {badge > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} tone="onAccent">
              {badge > 9 ? "9+" : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" style={[styles.slotLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  slot: {
    flex: 1,
    height: BOTTOM_BAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  slotPressed: { backgroundColor: tokens.bg.elevated },
  slotLabel: { fontSize: 11, lineHeight: 14, fontWeight: tokens.font.weight.medium },
  paste: {
    flex: 1.2,
    marginVertical: tokens.space.sm,
    marginHorizontal: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: tokens.space.sm,
    ...glow(tokens.neon.pinkGlow),
  },
  pastePressed: { backgroundColor: tokens.accent.muted },
  pasteLabel: { fontSize: 11, lineHeight: 16 },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.pink,
  },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: tokens.font.weight.bold },
});
