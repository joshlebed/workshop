// The projection flip's motion signature: rows arrive one after another,
// travelling from the direction you came from, 120ms each and 18ms apart, and
// only the first six rows are staggered — past that the delay stops reading as
// rhythm and starts reading as lag. Stepped ease-out; nothing overshoots.

import { type ReactNode, useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { tokens } from "../../../theme";

interface StaggerProps {
  index: number;
  /** +1 enters from the right, -1 from the left. */
  direction: 1 | -1;
  children: ReactNode;
}

export function Stagger({ index, direction, children }: StaggerProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      Math.min(index, tokens.motion.staggerMax) * tokens.motion.stagger,
      withTiming(1, { duration: tokens.motion.base, easing: Easing.out(Easing.quad) }),
    );
    // Mount-only: the lists are keyed by projection, so flipping remounts every
    // row and replays the stagger.
  }, [index, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * direction * tokens.motion.shift }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
