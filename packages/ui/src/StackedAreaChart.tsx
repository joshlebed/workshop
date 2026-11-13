// Stacked area chart for the admin analytics dashboards: one band per series
// over daily (or weekly) points, e.g. users per app version. Pure
// react-native Views so it bundles on web and iOS without SVG or a chart
// library: the plot is cut into narrow columns and each column draws the
// bands at heights interpolated between the two nearest points, which reads
// as straight band edges at this size.
//
// Follows the dataviz mark spec: a hairline surface gap between bands,
// recessive gridlines, a legend (always, since there are several series), a
// crosshair + tooltip on hover/press, and text in text tokens only. Colors
// are the validated dark categorical palette, assigned in stack order.

import { useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tokens as theme } from "./theme";

export interface StackedAreaSegment {
  key: string;
  label: string;
  /** `day` is `YYYY-MM-DD` (UTC); every segment has the same days in the same order. */
  points: { day: string; value: number }[];
}

export interface StackedAreaChartProps {
  /** Bands in stack order, bottom first. At most eight are colored distinctly. */
  segments: StackedAreaSegment[];
  /** What one point covers; a weekly point is labelled by the week it starts. */
  bucket?: "day" | "week";
  /** `count`: band height is the value. `share`: every point is scaled to 100%. */
  mode?: "count" | "share";
  /** Plot height in px, excluding the axis label row. */
  height?: number;
  testID?: string;
}

// Dark-surface categorical palette (dataviz reference instance), validated
// against this app's card surface: adjacent bands stay ≥8 ΔE apart under CVD.
const SERIES_COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
const SURFACE = theme.bg.surface;

const PLOT_HEIGHT = 180;
const COLUMN = 3;
const GUTTER = 36;
const TOOLTIP_WIDTH = 200;

function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 3, 4, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${month} ${Number(d)}`;
}

export function StackedAreaChart({
  segments,
  bucket = "day",
  mode = "count",
  height = PLOT_HEIGHT,
  testID,
}: StackedAreaChartProps) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const days = useMemo(() => segments[0]?.points.map((p) => p.day) ?? [], [segments]);
  const n = days.length;

  const totals = useMemo(
    () => days.map((_, i) => segments.reduce((acc, s) => acc + (s.points[i]?.value ?? 0), 0)),
    [days, segments],
  );
  const ceiling = mode === "share" ? 1 : niceCeiling(Math.max(0, ...totals));

  // Each band's height at each point as a fraction of the plot.
  const fractions = useMemo(
    () =>
      segments.map((s) =>
        days.map((_, i) => {
          const v = s.points[i]?.value ?? 0;
          if (mode === "share") {
            const total = totals[i] ?? 0;
            return total > 0 ? v / total : 0;
          }
          return v / ceiling;
        }),
      ),
    [segments, days, totals, mode, ceiling],
  );

  // One entry per column: the px height of each band, from cumulative
  // rounded boundaries so neighbouring columns line up without seams.
  const columns = useMemo(() => {
    if (width <= 0 || n === 0) return [];
    const count = Math.ceil(width / COLUMN);
    return Array.from({ length: count }, (_, c) => {
      const t = n > 1 ? Math.min(1, ((c + 0.5) * COLUMN) / width) * (n - 1) : 0;
      const i0 = Math.min(Math.floor(t), Math.max(0, n - 2));
      const f = t - i0;
      let cumulative = 0;
      let previousPx = 0;
      return fractions.map((series) => {
        const a = series[i0] ?? 0;
        const b = series[i0 + 1] ?? a;
        cumulative += a + (b - a) * f;
        const boundary = Math.round(Math.min(1, cumulative) * height);
        const h = boundary - previousPx;
        previousPx = boundary;
        return h;
      });
    });
  }, [width, n, fractions, height]);

  const onPlotLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));

  if (segments.length === 0 || totals.every((t) => t === 0)) {
    return (
      <Text variant="caption" tone="muted" testID={testID}>
        No data yet.
      </Text>
    );
  }

  const labelFor = (day: string) =>
    bucket === "week" ? `Week of ${shortDay(day)}` : shortDay(day);
  const colorOf = (index: number) =>
    SERIES_COLORS[index % SERIES_COLORS.length] ?? theme.text.secondary;
  const xOf = (index: number) => (n > 1 ? (index / (n - 1)) * width : width / 2);
  const activeDay = active !== null ? days[active] : undefined;
  const activeTotal = active !== null ? (totals[active] ?? 0) : 0;
  const gridLabel = (fraction: number) =>
    mode === "share" ? `${fraction * 100}%` : String(ceiling * fraction);

  return (
    <View testID={testID} style={styles.root}>
      <View style={styles.legend}>
        {segments.map((s, i) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colorOf(i) }]} />
            <Text variant="caption" tone="secondary">
              {s.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={[styles.plot, { height }]}>
        <View style={styles.area} onLayout={onPlotLayout}>
          {columns.map((heights, c) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional slices of the plot.
              key={c}
              pointerEvents="none"
              style={[styles.column, { left: c * COLUMN }]}
            >
              {heights.map((h, s) =>
                h > 0 ? (
                  <View
                    key={segments[s]?.key ?? s}
                    style={[
                      { height: h, backgroundColor: colorOf(s) },
                      h >= 3 ? styles.bandEdge : null,
                    ]}
                  />
                ) : null,
              )}
            </View>
          ))}
          {active !== null ? (
            <View pointerEvents="none" style={[styles.crosshair, { left: xOf(active) }]} />
          ) : null}
          {/* One hit slot per point, centred on it: the end slots are half-width. */}
          <View style={styles.slots}>
            {days.map((day, i) => (
              <Pressable
                key={day}
                role="img"
                focusable={false}
                accessibilityLabel={`${labelFor(day)}: ${totals[i] ?? 0}`}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((cur) => (cur === i ? null : cur))}
                onPressIn={() => setActive(i)}
                onPressOut={() => setActive((cur) => (cur === i ? null : cur))}
                style={{ flex: n > 1 && (i === 0 || i === n - 1) ? 0.5 : 1 }}
              />
            ))}
          </View>
        </View>
        {/* Recessive gridlines at ½ / max, labelled in the right gutter. */}
        {[1, 0.5].map((fraction) =>
          mode === "share" || Number.isInteger(ceiling * fraction) ? (
            <View
              key={fraction}
              pointerEvents="none"
              style={[
                styles.gridline,
                { top: height * (1 - fraction), borderTopColor: theme.border.subtle },
              ]}
            >
              <Text variant="caption" tone="muted" style={styles.gridLabel}>
                {gridLabel(fraction)}
              </Text>
            </View>
          ) : null,
        )}
        <View
          pointerEvents="none"
          style={[styles.gridline, { top: height, borderTopColor: theme.border.default }]}
        />
        {activeDay && active !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                left: xOf(active),
                transform: [{ translateX: active > n / 2 ? -(TOOLTIP_WIDTH + 8) : 8 }],
              },
            ]}
          >
            <Text variant="caption" tone="muted">
              {labelFor(activeDay)}
            </Text>
            <Text variant="label">{activeTotal.toLocaleString()} total</Text>
            {/* Top band first, matching the stack as drawn. */}
            {segments
              .map((s, i) => ({ s, i, value: s.points[active]?.value ?? 0 }))
              .filter((e) => e.value > 0)
              .reverse()
              .map((e) => (
                <View key={e.s.key} style={styles.tooltipRow}>
                  <View style={[styles.swatch, { backgroundColor: colorOf(e.i) }]} />
                  <Text variant="caption" tone="secondary">
                    {e.s.label}: {e.value.toLocaleString()} (
                    {Math.round((e.value / activeTotal) * 100)}%)
                  </Text>
                </View>
              ))}
          </View>
        ) : null}
      </View>
      <View style={styles.axis}>
        <Text variant="caption" tone="muted">
          {days[0] ? shortDay(days[0]) : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {n > 2 ? shortDay(days[Math.floor(n / 2)] ?? "") : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {days[n - 1] ? shortDay(days[n - 1] ?? "") : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  plot: { position: "relative", width: "100%", marginTop: 20 },
  area: {
    position: "absolute",
    left: 0,
    right: GUTTER,
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
  column: {
    position: "absolute",
    bottom: 0,
    width: COLUMN,
    flexDirection: "column-reverse",
  },
  // The surface-colored line that separates a band from the one above it.
  bandEdge: { borderTopWidth: 1, borderTopColor: SURFACE },
  crosshair: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: theme.text.primary,
  },
  slots: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
  },
  gridline: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-end",
  },
  gridLabel: { marginTop: -16, paddingRight: 2, width: GUTTER, textAlign: "right" },
  tooltip: {
    position: "absolute",
    top: 0,
    width: TOOLTIP_WIDTH,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    backgroundColor: theme.bg.elevated,
    borderColor: theme.border.default,
  },
  tooltipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingRight: GUTTER,
  },
});
