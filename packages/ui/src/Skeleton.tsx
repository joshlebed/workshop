import { useEffect } from "react";
import { type DimensionValue, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { listRowMetrics } from "./ListRow";
import { tokens } from "./theme";

interface BlockProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** A placeholder shape. Pulses gently; holds still under reduced motion. */
function Block({ width = "100%", height = 14, radius = tokens.radius.sm, style }: BlockProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.value * 0.35 }));
  return (
    <Animated.View
      style={[styles.block, { width, height, borderRadius: radius }, animated, style]}
    />
  );
}

interface RowProps {
  /** Leading badge size (matches `EmojiBadge`); `0` for a row without one. */
  badge?: 0 | 24 | 44;
  /** Show the second (subtitle) line. */
  subtitle?: boolean;
  /** Title bar width, so a stack of rows doesn't look stamped. */
  titleWidth?: DimensionValue;
}

/** A `ListRow`-shaped placeholder: same height, padding, badge and lines. */
function Row({ badge = 44, subtitle = true, titleWidth = "62%" }: RowProps) {
  return (
    <View style={styles.row}>
      {badge ? <Block width={badge} height={badge} radius={badge / 2} /> : null}
      <View style={styles.rowBody}>
        <Block width={titleWidth} height={14} />
        {subtitle ? <Block width="38%" height={10} /> : null}
      </View>
    </View>
  );
}

const ROW_WIDTHS: DimensionValue[] = ["62%", "48%", "71%", "54%", "66%", "44%", "58%", "69%"];

interface RowsProps extends Omit<RowProps, "titleWidth"> {
  count?: number;
  testID?: string;
}

/** A first-load list: `count` rows, announced once as loading. */
function Rows({ count = 6, testID, ...row }: RowsProps) {
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      aria-busy
      testID={testID}
      style={styles.rows}
    >
      {Array.from({ length: count }, (_, i) => (
        <Row
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={i}
          {...row}
          titleWidth={ROW_WIDTHS[i % ROW_WIDTHS.length]}
        />
      ))}
    </View>
  );
}

/**
 * Loading placeholders shaped like the content they stand in for. Use on
 * first load only; cached content is never replaced by a skeleton.
 */
export const Skeleton = { Block, Row, Rows };

const styles = StyleSheet.create({
  block: { backgroundColor: tokens.bg.elevated },
  rows: { paddingTop: tokens.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: listRowMetrics.gap,
    minHeight: listRowMetrics.minHeight,
    paddingVertical: listRowMetrics.paddingVertical,
    paddingHorizontal: listRowMetrics.paddingHorizontal,
    marginHorizontal: listRowMetrics.marginHorizontal,
  },
  rowBody: { flex: 1, gap: tokens.space.sm },
});
