// Motion presets (DESIGN.md → Motion). Every Workshop animation runs on one of
// the three `tokens.motion` durations and the one ease-out curve; nothing
// bounces, nothing springs unless a finger is driving it.
//
// Reduced motion (iOS "Reduce Motion", web `prefers-reduced-motion`): movement
// goes (translation, scale, rows sliding), fades stay. So the fade presets
// below opt out of Reanimated's automatic skip (`ReduceMotion.Never`) and the
// movement preset keeps it (`ReduceMotion.System`); a component that
// translates or scales by hand checks `useReducedMotion()` and drops it.
//
// The layout-animation builders are shared instances: pass them as-is, never
// chain on them (`motionPresets.enter.delay(…)` would mutate the shared one).

import { useState } from "react";
import {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
  type WithTimingConfig,
} from "react-native-reanimated";
import { tokens } from "./theme";

export type MotionSpeed = "fast" | "base" | "slow";

/** The one curve, for Reanimated (`withTiming`, layout animations). */
export const easeOut = Easing.bezier(...tokens.motion.easeOut);

/** The one curve, as CSS (dnd-kit transitions, web-only styles). */
export const easeOutCss = `cubic-bezier(${tokens.motion.easeOut.join(", ")})`;

/**
 * `withTiming` config on a motion token and the one curve. Keeps playing under
 * reduced motion, so use it for opacity and colour; a caller animating a
 * transform must drop that transform when `useReducedMotion()` is true.
 */
export function timing(speed: MotionSpeed): WithTimingConfig {
  return { duration: tokens.motion[speed], easing: easeOut, reduceMotion: ReduceMotion.Never };
}

export const motionPresets = {
  /**
   * A row joining a section (completed, restored, filtered back in, Done
   * expanded): waits `fast` while its neighbours slide to make room
   * (`move`), then fades in at `fast`. Without the wait it shows at its slot
   * while a neighbour is still sliding through it.
   */
  enter: FadeIn.duration(tokens.motion.fast)
    .delay(tokens.motion.fast)
    .easing(easeOut)
    .reduceMotion(ReduceMotion.Never),
  /** A row or block leaving: fade out at `fast` (exits are quicker). */
  exit: FadeOut.duration(tokens.motion.fast).easing(easeOut).reduceMotion(ReduceMotion.Never),
  /** Content replacing its skeleton: a quick fade, nothing moves. */
  reveal: FadeIn.duration(tokens.motion.fast).easing(easeOut).reduceMotion(ReduceMotion.Never),
  /**
   * Siblings sliding to their new place after a row enters, leaves or moves.
   * Movement, so Reanimated skips it under reduced motion.
   */
  move: LinearTransition.duration(tokens.motion.base)
    .easing(easeOut)
    .reduceMotion(ReduceMotion.System),
};

/**
 * A movement duration (ms) that honours reduced motion: the token, or 0 when
 * the user asked for less motion. For movement driven outside Reanimated's
 * presets (dnd-kit's sortable transition, the reorderable list's drop).
 */
export function useMotionDuration(speed: MotionSpeed): number {
  return useReducedMotion() ? 0 : tokens.motion[speed];
}

/**
 * True once a skeleton that was on screen has been replaced: latches when
 * `loading` is seen true, so the content that follows can fade in
 * (`<Reveal when={…}>`). Content that renders straight from cache never
 * showed a skeleton and appears without a fade.
 */
export function useRevealAfterLoading(loading: boolean): boolean {
  const [showedSkeleton, setShowedSkeleton] = useState(loading);
  if (loading && !showedSkeleton) setShowedSkeleton(true);
  return showedSkeleton && !loading;
}
