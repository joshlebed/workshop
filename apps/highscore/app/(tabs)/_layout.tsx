import { Tabs, usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hs, PixelIcon, type PixelIconName, Text, tokens } from "../../src/theme";

// Marquee control panel: HighScore's bottom bar reads as the cabinet's
// control deck — surface.1 with a 2px bezel top edge, pixel-face labels, and
// the reserved pink glow on the active tab. Only the Games home lives inside
// the (tabs) group today, so the panel renders its own buttons: GAMES is the
// real tab; FRIENDS pushes the stack route (its screen carries its own back
// affordance).
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={() => <ControlPanel />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Games" }} />
    </Tabs>
  );
}

function ControlPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const onFriends = pathname.startsWith("/friends");
  return (
    <View style={[styles.panel, { paddingBottom: insets.bottom }]}>
      <PanelButton
        label="Games"
        icon="gamepad"
        active={!onFriends}
        onPress={() => router.navigate("/")}
        testID="tab-games"
      />
      <PanelButton
        label="Friends"
        icon="users"
        active={onFriends}
        onPress={() => router.push("/friends")}
        testID="tab-friends"
      />
    </View>
  );
}

interface PanelButtonProps {
  label: string;
  icon: PixelIconName;
  active: boolean;
  onPress: () => void;
  testID?: string;
}

function PanelButton({ label, icon, active, onPress, testID }: PanelButtonProps) {
  const color = active ? hs.color.primary : hs.color.textSecondary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <View style={[styles.slot, active && styles.slotActive]}>
        <PixelIcon name={icon} size={24} color={color} />
        <Text variant="pixel" style={{ color }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexDirection: "row",
    backgroundColor: hs.color.surface1,
    borderTopWidth: hs.bezel,
    borderTopColor: hs.color.border,
  },
  button: { flex: 1, alignItems: "center", paddingVertical: hs.space.sm },
  buttonPressed: { backgroundColor: hs.color.surface2 },
  slot: {
    alignItems: "center",
    gap: hs.space.xs,
    paddingVertical: hs.space.xs,
    paddingHorizontal: hs.space.lg,
    borderRadius: hs.radius,
  },
  // The active control glows pink — one of the few designated glow elements.
  slotActive: { boxShadow: hs.glow.primary },
});
