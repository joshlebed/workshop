// The single sheet host.
//
// One host, one RN view layer, one gesture — every secondary surface in
// HighScore (game board, friends, a friend's profile, your account) is rendered
// here, over the timeline, which stays mounted and visible behind. There is
// deliberately no second Modal: the host is a plain absolutely-positioned
// overlay, so the "never stack two RNModals in one tick" footgun in the root
// CLAUDE.md cannot happen between navigation sheets. The small utility sheets
// that ride *on top* of a sheet (paste, reactions, add-game) are the only
// RNModals in the app, and only one can ever be open.
//
// Navigation inside the host is an internal stack derived from the URL: pushing
// `/friends/:userId` while `/friends` is open slides the profile in over the
// list; going back pops it. See `sheetRoute.ts`.

import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AccountSheet } from "../sheets/AccountSheet";
import { FriendProfileSheet } from "../sheets/FriendProfileSheet";
import { FriendsSheet } from "../sheets/FriendsSheet";
import { GameBoardSheet } from "../sheets/GameBoardSheet";
import { screenColumnMaxWidth } from "../theme";
import { tokens } from "../theme/tokens";
import { parseSheetRoute, type SheetEntry } from "./sheetRoute";

/** Bare grey strip of timeline left visible above a fully-open sheet. */
const TOP_INSET = 72;
/** Second snap point, as a fraction of sheet height pushed down. */
const HALF = 0.46;

export interface SheetNav {
  /** Pop one level — back to the sheet beneath, or the timeline. */
  back: () => void;
  /** Dismiss the whole stack back to the timeline. */
  close: () => void;
  /** How many sheets are stacked (1 = this is the only one). */
  depth: number;
}

export function SheetHost() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ via?: string }>();
  const via = typeof params.via === "string" ? params.via : null;
  const current = useMemo(() => parseSheetRoute(pathname, via), [pathname, via]);

  const { height } = useWindowDimensions();
  const sheetHeight = Math.max(320, height - TOP_INSET);

  const [stack, setStack] = useState<SheetEntry[]>([]);
  // +1 when a sheet is pushed, -1 when one is popped — drives which way the
  // content slides.
  const directionRef = useRef(1);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!current) return;
    setStack((prev) => {
      const index = prev.findIndex((entry) => entry.key === current.key);
      if (index >= 0) {
        directionRef.current = -1;
        return index === prev.length - 1 ? prev : prev.slice(0, index + 1);
      }
      directionRef.current = 1;
      return [...prev, current];
    });
  }, [current]);

  const open = current != null;
  const y = useSharedValue(sheetHeight);
  // The sheet is sized by its content up to `sheetHeight`, so the dismiss
  // thresholds have to read the measured height, not the ceiling — otherwise a
  // short sheet (your account) needs a drag longer than the sheet itself.
  const measured = useSharedValue(sheetHeight);
  const contentX = useSharedValue(0);
  const contentOpacity = useSharedValue(1);

  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) y.value = sheetHeight;
      wasOpenRef.current = true;
      y.value = withTiming(0, { duration: tokens.motion.base, easing: Easing.out(Easing.cubic) });
      return;
    }
    wasOpenRef.current = false;
    y.value = withTiming(
      sheetHeight,
      { duration: tokens.motion.fast, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setStack)([]);
      },
    );
  }, [open, sheetHeight, y]);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const topKey = top?.key ?? null;

  useEffect(() => {
    if (!topKey) return;
    contentX.value = directionRef.current * 24;
    contentOpacity.value = 0;
    contentX.value = withTiming(0, {
      duration: tokens.motion.fast,
      easing: Easing.out(Easing.quad),
    });
    contentOpacity.value = withTiming(1, { duration: tokens.motion.fast });
  }, [topKey, contentX, contentOpacity]);

  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const closeAll = () => router.replace("/");

  const dragStart = useSharedValue(0);
  const pan = Gesture.Pan()
    .onStart(() => {
      dragStart.value = y.value;
    })
    .onUpdate((event) => {
      y.value = Math.max(0, dragStart.value + event.translationY);
    })
    .onEnd((event) => {
      const height = measured.value;
      const halfY = height * HALF;
      // A flick dismisses from anywhere; a slow drag has to pass the halfway
      // snap first, so the peek state is reachable without closing by accident.
      if (y.value > height * 0.58 || event.velocityY > 900) {
        y.value = withTiming(
          height,
          { duration: tokens.motion.fast, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(dismiss)();
          },
        );
        return;
      }
      const settleTo = y.value > halfY * 0.55 && event.velocityY > -200 ? halfY : 0;
      y.value = withTiming(settleTo, {
        duration: tokens.motion.fast,
        easing: Easing.out(Easing.cubic),
      });
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, measured.value], [0.82, 0], Extrapolation.CLAMP),
  }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: contentX.value }],
  }));

  if (!top) return null;

  const nav: SheetNav = { back: dismiss, close: closeAll, depth: stack.length };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="sheet-host">
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={dismiss}
        style={StyleSheet.absoluteFill}
        testID="sheet-backdrop"
      />
      <View style={styles.host} pointerEvents="box-none">
        <Animated.View
          onLayout={(event) => {
            measured.value = event.nativeEvent.layout.height;
          }}
          style={[styles.sheet, { maxHeight: sheetHeight }, sheetStyle]}
          testID={`sheet-${top.kind}`}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.grabArea}>
              <View style={styles.grip}>
                {GRIP_PIPS.map((pip) => (
                  <View key={pip} style={styles.gripPip} />
                ))}
              </View>
            </View>
          </GestureDetector>
          <Animated.View style={[styles.content, contentStyle]}>
            <SheetBody entry={top} nav={nav} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

// Five pips — the grip reads as a pixel grille rather than a rounded pill.
const GRIP_PIPS = [0, 1, 2, 3, 4];

function SheetBody({ entry, nav }: { entry: SheetEntry; nav: SheetNav }) {
  switch (entry.kind) {
    case "game":
      return <GameBoardSheet gameId={entry.gameId} nav={nav} />;
    case "friends":
      return <FriendsSheet nav={nav} />;
    case "friend":
      return <FriendProfileSheet userId={entry.userId} via={entry.via} nav={nav} />;
    case "account":
      return <AccountSheet nav={nav} />;
  }
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "#08060C" },
  host: {
    flex: 1,
    justifyContent: "flex-end",
    ...Platform.select({ web: { alignItems: "center" }, default: {} }),
  },
  sheet: {
    width: "100%",
    backgroundColor: tokens.bg.surface,
    borderTopWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
    ...Platform.select({
      web: { maxWidth: screenColumnMaxWidth, borderLeftWidth: tokens.bezel, borderRightWidth: 0 },
      default: {},
    }),
  },
  grabArea: {
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.sm,
    alignItems: "center",
    // RN's `CursorValue` only knows "auto"/"pointer"; RNW forwards any CSS
    // cursor, and a drag handle should read as one.
    ...(Platform.OS === "web" ? ({ cursor: "grab" } as unknown as ViewStyle) : null),
  },
  grip: { flexDirection: "row", gap: 4 },
  gripPip: { width: 4, height: 4, backgroundColor: tokens.border.default },
  content: { flex: 1 },
});
