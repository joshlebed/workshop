// Quick actions, thrown up from the dock's YOU key on a long press.
//
// Deliberately not a Sheet: a Sheet is an RN Modal, and the dock lives outside
// it, so the menu would cover the very key you're holding. This is a plain
// overlay inside the screen — the dock stays lit underneath, the keys stack up
// from it, and everything is still one thumb away from where your finger
// already is.
//
// Keys rise in sequence (a 30ms stagger, stepped), nearest-to-the-thumb first.
// Tapping the YOU key instead opens the full YOU screen — this is the shortcut,
// not the only route.

import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DOCK_HEIGHT } from "../nav/dock";
import { PixelIcon, type PixelIconName } from "../theme/PixelIcon";
import { Text } from "../theme/Text";
import { stepped, tokens } from "../theme/tokens";

export interface QuickAction {
  id: string;
  label: string;
  glyph: PixelIconName;
  onPress: () => void;
  tone?: "quiet" | "danger";
  testID?: string;
}

export interface QuickMenuProps {
  visible: boolean;
  actions: QuickAction[];
  onClose: () => void;
}

const STAGGER = 30;

export function QuickMenu({ visible, actions, onClose }: QuickMenuProps) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} testID="quick-menu">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close quick actions"
        onPress={onClose}
        style={styles.scrim}
      />
      <View style={[styles.stack, { bottom: insets.bottom + DOCK_HEIGHT + tokens.space.md }]}>
        {/* Nearest the thumb first, so the stagger reads as rising off the key. */}
        {actions.map((action, i) => (
          <QuickKey
            key={action.id}
            action={action}
            delay={(actions.length - 1 - i) * STAGGER}
            onClose={onClose}
          />
        ))}
      </View>
    </View>
  );
}

function QuickKey({
  action,
  delay,
  onClose,
}: {
  action: QuickAction;
  delay: number;
  onClose: () => void;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: tokens.motion.fast, easing: stepped }),
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  const danger = action.tone === "danger";
  const color = danger ? tokens.status.danger : tokens.text.primary;

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.label}
        testID={action.testID}
        onPress={() => {
          onClose();
          action.onPress();
        }}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.key,
          danger && styles.keyDanger,
          (pressed || hovered) && styles.keyActive,
        ]}
      >
        <Text variant="heading" style={[styles.label, { color }]}>
          {action.label}
        </Text>
        <PixelIcon name={action.glyph} size={16} color={color} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.72)" },
  stack: {
    position: "absolute",
    pointerEvents: "box-none",
    right: tokens.space.md,
    left: tokens.space.md,
    alignItems: "flex-end",
    gap: tokens.space.sm,
    ...Platform.select({ web: { maxWidth: 560, alignSelf: "center" }, default: {} }),
  },
  key: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    height: 42,
    paddingHorizontal: tokens.space.lg,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  keyDanger: { borderColor: tokens.status.danger },
  keyActive: { backgroundColor: tokens.bg.raised },
  label: { fontSize: 11 },
});
