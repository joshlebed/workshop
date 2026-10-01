// The dock — HighScore's single piece of navigation chrome.
//
// One bar, bottom-anchored, always inside thumb reach. It is *not* a tab bar:
// its keys are whatever the screen on top of the stack says they are, and the
// bar morphs between key sets instead of swapping bars. A key that survives a
// screen change (BACK, PASTE) keeps its slot and just re-labels; keys that
// don't survive collapse their width to zero and leave.
//
// Screens register through `useDock`. Registrations form a stack keyed by a
// per-mount id, so a pushed screen's keys sit on top of the pusher's and the
// pusher's come back on pop — expo-router keeps both mounted, so a plain
// "last write wins" would leave the wrong keys up after a pop.
//
// A screen that registers nothing (sign-in, onboarding, the legal pages) gets
// no dock at all: the bar animates itself off-screen rather than rendering an
// empty frame.

import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PixelIcon, type PixelIconName } from "../theme/PixelIcon";
import { Text } from "../theme/Text";
import { glow, stepped, tokens } from "../theme/tokens";

export interface DockKey {
  /** Stable across screens: a shared id keeps the slot and morphs in place. */
  id: string;
  label: string;
  glyph: PixelIconName;
  onPress: () => void;
  onLongPress?: () => void;
  /** Relative width. 1 = a normal key; the lit key on a screen takes more. */
  weight?: number;
  tone?: "quiet" | "primary" | "danger";
  disabled?: boolean;
  /** Small pink corner notch — unread/pending signal, no number. */
  notch?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

/** Content inset every docked screen owes the bar (excludes the safe area). */
export const DOCK_HEIGHT = 60;

interface DockContextValue {
  push: (id: string, keys: DockKey[]) => void;
  pop: (id: string) => void;
}

const DockContext = createContext<DockContextValue | null>(null);

export function DockProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ id: string; keys: DockKey[] }[]>([]);

  const push = useCallback((id: string, keys: DockKey[]) => {
    setStack((prev) => {
      const at = prev.findIndex((e) => e.id === id);
      if (at === -1) return [...prev, { id, keys }];
      const next = prev.slice();
      next[at] = { id, keys };
      return next;
    });
  }, []);

  const pop = useCallback((id: string) => {
    setStack((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const value = useMemo(() => ({ push, pop }), [push, pop]);
  const keys = stack.length > 0 ? (stack[stack.length - 1]?.keys ?? []) : [];

  return (
    <DockContext.Provider value={value}>
      {children}
      <Dock keys={keys} />
    </DockContext.Provider>
  );
}

/**
 * Register this screen's dock keys. `keys` must be memoized by the caller —
 * it's an effect dependency, and an unstable array re-registers every render.
 */
export function useDock(keys: DockKey[]): void {
  const ctx = useContext(DockContext);
  const id = useId();
  const push = ctx?.push;
  const pop = ctx?.pop;
  useEffect(() => {
    push?.(id, keys);
  }, [push, id, keys]);
  useEffect(() => () => pop?.(id), [pop, id]);
}

interface SlotState {
  key: DockKey;
  leaving: boolean;
}

function Dock({ keys }: { keys: DockKey[] }) {
  const insets = useSafeAreaInsets();
  const [slots, setSlots] = useState<SlotState[]>(() =>
    keys.map((k) => ({ key: k, leaving: false })),
  );

  useEffect(() => {
    setSlots((prev) => {
      const live = keys.map((k) => ({ key: k, leaving: false }));
      const liveIds = new Set(keys.map((k) => k.id));
      // Keep departing keys mounted for one transition so they can collapse
      // instead of popping out. They're spliced back into their old index so
      // the surviving keys don't jump sideways on the way out.
      const departing = prev.filter((s) => !s.leaving && !liveIds.has(s.key.id));
      if (departing.length === 0) return live;
      const merged = live.slice();
      for (const d of departing) {
        const at = prev.findIndex((s) => s.key.id === d.key.id);
        merged.splice(Math.min(at, merged.length), 0, { key: d.key, leaving: true });
      }
      return merged;
    });
  }, [keys]);

  useEffect(() => {
    if (!slots.some((s) => s.leaving)) return;
    const t = setTimeout(
      () => setSlots((prev) => prev.filter((s) => !s.leaving)),
      tokens.motion.base,
    );
    return () => clearTimeout(t);
  }, [slots]);

  const visible = keys.length > 0;
  const barStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(visible ? 0 : DOCK_HEIGHT + 48, {
          duration: tokens.motion.base,
          easing: stepped,
        }),
      },
    ],
  }));

  if (slots.length === 0) return null;

  // Weights are ratios, not fractions: normalise so the smallest live key has
  // flexGrow ≥ 1, otherwise a lone narrow key (a screen whose only action is
  // BACK) leaves the bar two-thirds empty.
  const liveWeights = keys.map((k) => k.weight ?? 1);
  const scale = liveWeights.length > 0 ? 1 / Math.min(1, ...liveWeights) : 1;

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom || tokens.space.sm,
          pointerEvents: visible ? "auto" : "none",
        },
        barStyle,
      ]}
      testID="dock"
    >
      <View style={styles.row}>
        {slots.map((slot) => (
          <DockKeyView key={slot.key.id} dockKey={slot.key} leaving={slot.leaving} scale={scale} />
        ))}
      </View>
    </Animated.View>
  );
}

const BLINK = Math.round(tokens.motion.fast / 2);

const DockKeyView = memo(function DockKeyView({
  dockKey,
  leaving,
  scale,
}: {
  dockKey: DockKey;
  leaving: boolean;
  scale: number;
}) {
  const weight = (dockKey.weight ?? 1) * scale;
  const grow = useSharedValue(leaving ? 0 : weight);
  const fade = useSharedValue(leaving ? 0 : 1);

  useEffect(() => {
    grow.value = withTiming(leaving ? 0 : weight, {
      duration: tokens.motion.base,
      easing: stepped,
    });
    fade.value = withTiming(leaving ? 0 : 1, { duration: tokens.motion.fast, easing: stepped });
  }, [leaving, weight, grow, fade]);

  const shellStyle = useAnimatedStyle(() => ({ flexGrow: grow.value, opacity: fade.value }));

  const primary = dockKey.tone === "primary";
  const danger = dockKey.tone === "danger";
  const color = dockKey.disabled
    ? tokens.text.secondary
    : primary
      ? tokens.text.onAccent
      : danger
        ? tokens.status.danger
        : tokens.text.secondary;

  return (
    <Animated.View style={[styles.slot, shellStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dockKey.accessibilityLabel ?? dockKey.label}
        accessibilityState={{ disabled: !!dockKey.disabled }}
        onPress={dockKey.disabled ? undefined : dockKey.onPress}
        {...(dockKey.onLongPress ? { onLongPress: dockKey.onLongPress, delayLongPress: 260 } : {})}
        testID={dockKey.testID}
        style={({ pressed }) => [
          styles.key,
          primary && styles.keyPrimary,
          primary && !dockKey.disabled && glowStyle,
          danger && styles.keyDanger,
          pressed && styles.keyPressed,
          dockKey.disabled && styles.keyDisabled,
        ]}
      >
        <BlinkOnChange
          value={dockKey.glyph}
          render={(glyph) => <PixelIcon name={glyph as PixelIconName} size={16} color={color} />}
        />
        <BlinkOnChange
          value={dockKey.label}
          render={(label) => (
            <Text
              variant="heading"
              numberOfLines={1}
              style={[styles.keyLabel, { color }]}
              allowFontScaling={false}
            >
              {label}
            </Text>
          )}
        />
        {dockKey.notch ? <View style={styles.notch} /> : null}
      </Pressable>
    </Animated.View>
  );
});

/**
 * Two-frame arcade blink whenever `value` changes — a key doesn't crossfade
 * its label, it cuts to black and back the way a segment display does. Takes a
 * render function rather than children so the swap is driven by the string,
 * not by a fresh element identity on every parent render.
 */
function BlinkOnChange({ value, render }: { value: string; render: (v: string) => ReactNode }) {
  const opacity = useSharedValue(1);
  const [displayed, setDisplayed] = useState(value);

  useEffect(() => {
    if (displayed === value) return;
    opacity.value = withSequence(
      withTiming(0, { duration: BLINK, easing: stepped }),
      withTiming(1, { duration: BLINK, easing: stepped }),
    );
    const t = setTimeout(() => setDisplayed(value), BLINK);
    return () => clearTimeout(t);
  }, [value, displayed, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={style}>{render(displayed)}</Animated.View>;
}

const glowStyle = glow(tokens.neon.pinkGlow, 12);

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: tokens.bg.canvas,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.sm,
    ...Platform.select({ web: { alignItems: "center" }, default: {} }),
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: tokens.space.sm,
    width: "100%",
    ...Platform.select({ web: { maxWidth: 560 }, default: {} }),
  },
  slot: { flexBasis: 0, minWidth: 0, overflow: "hidden" },
  key: {
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  keyPrimary: { borderColor: tokens.neon.pink, backgroundColor: tokens.neon.pink },
  keyDanger: { borderColor: tokens.status.danger },
  keyPressed: { opacity: 0.75 },
  keyDisabled: { opacity: 0.45 },
  keyLabel: { fontSize: 10, lineHeight: 16, letterSpacing: 1 },
  notch: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 6,
    height: 6,
    backgroundColor: tokens.neon.pink,
  },
});
