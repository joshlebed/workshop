// Web pull-to-refresh wrapper.
//
// `react-native-web`'s `RefreshControl` is a no-op stub (the source returns a
// bare <View>), and iOS Safari's native PTR only fires on the root document
// — which we explicitly lock at `overflow:hidden` in `app/+html.tsx` so the
// inner FlatList can own the scroll. That leaves PTR up to us on web.
//
// Implementation: wrap the FlatList in a positioned host View; clone the
// child to inject an `onScroll` so we always know the inner scrollTop;
// attach touch listeners on the host; when a touch starts at scrollTop === 0
// and the user drags down, render an `ActivityIndicator` translated +
// rotated by the pull distance. Releasing past the threshold calls
// `onRefresh`; while `refreshing` stays true the spinner pins to its
// "refreshing" position. Same API shape as `PullToRefresh.tsx` so callers
// share a single import.

import {
  cloneElement,
  isValidElement,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
} from "react-native";
import { tokens } from "./theme";

const PULL_THRESHOLD = 70;
const MAX_PULL = 120;
const RESIST = 0.55;
const SPINNER_REST_Y = -36;
const SPINNER_REFRESH_Y = 12;

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactElement;
}

export function PullToRefresh({ refreshing, onRefresh, children }: PullToRefreshProps) {
  const scrollTopRef = useRef(0);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const triggeredRef = useRef(false);
  const translateY = useRef(new Animated.Value(SPINNER_REST_Y)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [, force] = useState(0);

  // Keep the spinner pinned while a refresh is in flight (e.g. user
  // released past threshold, network is still running).
  useEffect(() => {
    if (refreshing) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SPINNER_REFRESH_Y,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    } else {
      // Snap back when the refresh resolves.
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SPINNER_REST_Y,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      pullRef.current = 0;
      triggeredRef.current = false;
    }
  }, [refreshing, translateY, opacity]);

  const onTouchStart = (event: { nativeEvent: { touches: ReadonlyArray<{ pageY: number }> } }) => {
    if (refreshing) return;
    if (scrollTopRef.current > 0) return;
    const t = event.nativeEvent.touches[0];
    if (!t) return;
    startYRef.current = t.pageY;
    pullRef.current = 0;
    triggeredRef.current = false;
  };

  const onTouchMove = (event: { nativeEvent: { touches: ReadonlyArray<{ pageY: number }> } }) => {
    if (startYRef.current == null) return;
    const t = event.nativeEvent.touches[0];
    if (!t) return;
    const dy = t.pageY - startYRef.current;
    if (dy <= 0) {
      // User is dragging upward — cancel the pull so a normal scroll resumes.
      if (pullRef.current !== 0) {
        pullRef.current = 0;
        translateY.setValue(SPINNER_REST_Y);
        rotate.setValue(0);
        opacity.setValue(0);
        force((n) => n + 1);
      }
      return;
    }
    // Rubber-band the pull so dragging feels heavier as you approach max.
    const resisted = Math.min(dy * RESIST, MAX_PULL);
    pullRef.current = resisted;
    const progress = resisted / PULL_THRESHOLD;
    translateY.setValue(SPINNER_REST_Y + resisted);
    rotate.setValue(progress);
    opacity.setValue(Math.min(progress, 1));
  };

  const onTouchEnd = () => {
    if (startYRef.current == null) return;
    const released = pullRef.current;
    startYRef.current = null;
    if (released >= PULL_THRESHOLD && !refreshing && !triggeredRef.current) {
      triggeredRef.current = true;
      // Pin spinner at its refreshing position immediately; the effect above
      // owns the snap-back once `refreshing` flips false.
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SPINNER_REFRESH_Y,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
      onRefresh();
      return;
    }
    // Didn't reach the threshold — snap back.
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SPINNER_REST_Y,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(rotate, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      pullRef.current = 0;
    });
  };

  // Spinner rotates 0 → 360deg as the user pulls from 0 → threshold.
  const spinnerRotate = rotate.interpolate({
    inputRange: [0, 1.5],
    outputRange: ["0deg", "540deg"],
    extrapolate: "clamp",
  });

  if (!isValidElement(children)) return children;

  // Inject scrollTop tracking + always-bounce-equivalent on the inner list.
  // We chain through any caller-provided onScroll so list-specific behavior
  // (infinite-scroll, etc.) isn't lost.
  type ChildProps = {
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    contentContainerStyle?: unknown;
    scrollEventThrottle?: number;
    alwaysBounceVertical?: boolean;
    overScrollMode?: "always" | "auto" | "never";
  };
  const childProps = (children as ReactElement<ChildProps>).props;
  const callerOnScroll = childProps.onScroll;
  const callerContentStyle = childProps.contentContainerStyle;

  const childWithScroll = cloneElement(children as ReactElement<ChildProps>, {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollTopRef.current = e.nativeEvent.contentOffset.y;
      callerOnScroll?.(e);
    },
    scrollEventThrottle: 16,
    alwaysBounceVertical: true,
    overScrollMode: "always",
    contentContainerStyle: [
      // Ensure content is at least viewport-tall so a touch-pull at the
      // top always has a chance to fire even when the list has one row.
      styles.minScrollHeight,
      callerContentStyle as object | undefined,
    ],
  });

  return (
    <View
      style={styles.host}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.spinner,
          {
            opacity,
            transform: [{ translateY }, { rotate: spinnerRotate }],
          },
        ]}
      >
        <ActivityIndicator color={tokens.accent.default} />
      </Animated.View>
      {childWithScroll}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
  spinner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  minScrollHeight: {
    // RN-Web doesn't render a bounce, so without this the touch-pull is
    // impossible when content < viewport. The +1 forces the scroll
    // container to be scrollable (even by a single pixel) so scrollTop=0
    // is a real anchor instead of an undefined state.
    minHeight: "100%" as unknown as number,
  },
});
