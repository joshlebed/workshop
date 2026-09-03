// Row-continues-into-the-header transitions.
//
// expo-router has no reliable shared-element API, so this fakes one honestly:
// on tap we measure the row's identity block in window coordinates, render a
// clone of it in a root-level overlay, and animate that clone to the exact
// rect the destination screen's header identity block will occupy. The push
// fires at the same moment with a `fade` screen animation, so the destination
// materialises *under* the clone and the clone dissolves onto its own header.
//
// The geometry contract is `DETAIL_IDENTITY` below: every screen that is a
// flight destination renders its identity block at that size and offset. If a
// measurement fails the caller still navigates — the flight is decoration on
// top of an ordinary push, never a prerequisite for it.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout, screenColumnMaxWidth, tokens } from "../theme";

/**
 * Where a detail screen puts its identity block, measured from the top of the
 * screen's own content box (i.e. below the safe-area inset) and from the
 * content column's left edge. `GameBoard` and `FriendProfile` both honour it.
 */
export const DETAIL_IDENTITY = { size: 44, top: 52, left: layout.inset } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Measurable {
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void;
}

interface FlightRequest {
  /** The source element, already on screen. */
  source: Measurable | null;
  /** A clone of the identity block, rendered at the destination's size. */
  node: ReactNode;
  /** Fired once the flight is under way — this is where you `router.push`. */
  navigate: () => void;
}

interface FlightContextValue {
  fly: (request: FlightRequest) => void;
}

const FlightContext = createContext<FlightContextValue | null>(null);

const DURATION = tokens.motion.base;
const FADE_OUT = 90;
/** How long to wait for a layout measurement before navigating without one. */
const MEASURE_FUSE_MS = 80;

export function FlightProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const from = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const to = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });

  const clear = useCallback(() => setNode(null), []);

  const targetRect = useCallback((): Rect => {
    // On web the content column is centred and capped; on native it fills.
    const columnLeft =
      Platform.OS === "web" ? Math.max(0, (width - Math.min(screenColumnMaxWidth, width)) / 2) : 0;
    return {
      x: columnLeft + DETAIL_IDENTITY.left,
      y: insets.top + DETAIL_IDENTITY.top,
      width: DETAIL_IDENTITY.size,
      height: DETAIL_IDENTITY.size,
    };
  }, [insets.top, width]);

  const fly = useCallback(
    ({ source, node: clone, navigate }: FlightRequest) => {
      if (!source || reduceMotion) {
        navigate();
        return;
      }
      // `measureInWindow` is best-effort: react-native-web can drop the
      // callback when the node has no layout yet (mid-stagger, for instance),
      // and a navigation that silently never happens is far worse than a
      // navigation without the flourish. Navigate on a short fuse either way.
      let navigated = false;
      const go = () => {
        if (navigated) return;
        navigated = true;
        navigate();
      };
      const fuse = setTimeout(go, MEASURE_FUSE_MS);
      source.measureInWindow((x, y, w, h) => {
        clearTimeout(fuse);
        if (navigated || !Number.isFinite(x) || w <= 0 || h <= 0) {
          go();
          return;
        }
        from.current = { x, y, width: w, height: h };
        to.current = targetRect();
        progress.value = 0;
        opacity.value = 1;
        setNode(clone);
        go();
        progress.value = withTiming(
          1,
          { duration: DURATION, easing: Easing.out(Easing.quad) },
          (finished) => {
            if (!finished) return;
            opacity.value = withTiming(0, { duration: FADE_OUT }, (done) => {
              if (done) runOnJS(clear)();
            });
          },
        );
      });
    },
    [clear, opacity, progress, reduceMotion, targetRect],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const a = from.current;
    const b = to.current;
    return {
      opacity: opacity.value,
      left: a.x + (b.x - a.x) * p,
      top: a.y + (b.y - a.y) * p,
      width: a.width + (b.width - a.width) * p,
      height: a.height + (b.height - a.height) * p,
    };
  });

  const value = useMemo(() => ({ fly }), [fly]);

  return (
    <FlightContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {node ? <Animated.View style={[styles.clone, animatedStyle]}>{node}</Animated.View> : null}
      </View>
    </FlightContext.Provider>
  );
}

export function useFlight(): FlightContextValue {
  const ctx = useContext(FlightContext);
  if (!ctx) throw new Error("useFlight must be used inside FlightProvider");
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  clone: { position: "absolute", overflow: "hidden", pointerEvents: "none" },
});
