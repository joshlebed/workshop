// Daily/weekly bar chart for the admin analytics dashboards, optionally
// stacked by a fixed set of segments. Pure react-native Views so it bundles
// on web and iOS without a chart library.
//
// Follows the dataviz mark spec: bars ≤ 24px with a 2px surface gap between
// stacked segments, rounded data-end and square baseline, hairline recessive
// gridlines, one direct label on the peak, a legend whenever there is more
// than one series, and a per-bar hover/press tooltip. Text wears text tokens,
// never the series color.

import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tokens as theme } from "./theme";

export interface BarChartPoint {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  value: number;
}

export interface BarChartSegment {
  key: string;
  label: string;
  color: string;
  /** Aligned 1:1 with the chart's `points`. */
  points: BarChartPoint[];
}

export interface BarChartProps {
  /** The bar totals (for a stacked chart: what the tooltip calls "total"). */
  points: BarChartPoint[];
  /** What one bar covers; a weekly bar is labelled by the week it starts. */
  bucket?: "day" | "week";
  /** Segments to draw instead of a single bar. */
  stack?: BarChartSegment[];
  /**
   * `sum`: segments stack to the total. `overlap`: each segment is its own
   * bar from the baseline, tallest drawn first, for distinct-user series
   * where segments legitimately exceed the total.
   */
  stackMode?: "sum" | "overlap";
  /** Plot height in px, excluding the axis label row. */
  height?: number;
  /** Single-series color; defaults to the theme accent. */
  color?: string;
  testID?: string;
}

const PLOT_HEIGHT = 140;
const MAX_BAR = 24;
const GAP = 2;

function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${month} ${Number(d)}`;
}

export function BarChart({
  points,
  bucket = "day",
  stack,
  stackMode = "sum",
  height = PLOT_HEIGHT,
  color,
  testID,
}: BarChartProps) {
  const labelFor = (day: string) =>
    bucket === "week" ? `Week of ${shortDay(day)}` : shortDay(day);
  // Static dark tokens, like `Text` and `Card`, so the tooltip surface and
  // its text always come from the same palette.
  const fill = color ?? theme.accent.default;
  const [active, setActive] = useState<number | null>(null);
  const segments = stack && stack.length > 0 ? stack : null;

  // The bar height per slot: the total for a plain or summed chart, the
  // tallest segment for an overlapped one.
  const barHeights = useMemo(
    () =>
      points.map((p, i) =>
        segments && stackMode === "overlap"
          ? Math.max(0, ...segments.map((s) => s.points[i]?.value ?? 0))
          : p.value,
      ),
    [points, segments, stackMode],
  );

  const { max, ceiling, peakIndex } = useMemo(() => {
    let max = 0;
    let peakIndex = -1;
    barHeights.forEach((v, i) => {
      if (v > max) {
        max = v;
        peakIndex = i;
      }
    });
    return { max, ceiling: niceCeiling(max), peakIndex };
  }, [barHeights]);

  const px = (value: number) => (ceiling > 0 ? Math.round((value / ceiling) * height) : 0);

  const first = points[0];
  const last = points[points.length - 1];
  const middle = points[Math.floor(points.length / 2)];
  const activePoint = active !== null ? points[active] : undefined;

  return (
    <View testID={testID} style={styles.root}>
      {segments ? (
        <View style={styles.legend}>
          {segments.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <Text variant="caption" tone="secondary">
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={[styles.plot, { height }]}>
        {/* Recessive gridlines at ½ / max, labelled on the right. */}
        {[1, 0.5].map((fraction) =>
          Number.isInteger(ceiling * fraction) ? (
            <View
              key={fraction}
              pointerEvents="none"
              style={[
                styles.gridline,
                { top: height * (1 - fraction), borderTopColor: theme.border.subtle },
              ]}
            >
              <Text variant="caption" tone="muted" style={styles.gridLabel}>
                {compact(ceiling * fraction)}
              </Text>
            </View>
          ) : null,
        )}
        <View
          pointerEvents="none"
          style={[styles.gridline, { top: height, borderTopColor: theme.border.default }]}
        />
        <View style={styles.bars}>
          {points.map((p, i) => {
            const isActive = active === i;
            const dim = active !== null && !isActive ? 0.45 : 1;
            let body: React.ReactNode;
            if (!segments) {
              const h = px(p.value);
              body = (
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(h, p.value > 0 ? 2 : 0),
                      backgroundColor: fill,
                      opacity: dim,
                    },
                  ]}
                />
              );
            } else if (stackMode === "sum") {
              // Bottom-up: later segments sit on top of earlier ones, each
              // separated by a surface-colored gap; only the top is rounded.
              const present = segments.filter((s) => (s.points[i]?.value ?? 0) > 0);
              body = (
                <View style={[styles.stackColumn, { opacity: dim }]}>
                  {[...present].reverse().map((s, idx) => (
                    <View
                      key={s.key}
                      style={[
                        styles.segment,
                        idx === 0 ? styles.bar : null,
                        {
                          height: Math.max(px(s.points[i]?.value ?? 0), 2),
                          backgroundColor: s.color,
                          marginTop: idx === 0 ? 0 : GAP,
                        },
                      ]}
                    />
                  ))}
                </View>
              );
            } else {
              // Overlap: every segment from the baseline, tallest at the back
              // and each one in front narrower, so equal heights stay visible
              // as nested bars instead of hiding each other.
              const ordered = segments
                .map((s) => ({ s, v: s.points[i]?.value ?? 0 }))
                .filter((e) => e.v > 0)
                .sort((a, b) => b.v - a.v);
              body = (
                <View style={[styles.overlapColumn, { opacity: dim }]}>
                  {ordered.map((e, idx) => (
                    <View
                      key={e.s.key}
                      style={[
                        styles.bar,
                        styles.overlapBar,
                        {
                          height: Math.max(px(e.v), 2),
                          backgroundColor: e.s.color,
                          width: `${100 - (idx * 100) / (ordered.length + 0.5)}%`,
                        },
                      ]}
                    />
                  ))}
                </View>
              );
            }
            return (
              <Pressable
                key={p.day}
                accessibilityLabel={`${labelFor(p.day)}: ${p.value}`}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((cur) => (cur === i ? null : cur))}
                onPressIn={() => setActive(i)}
                onPressOut={() => setActive((cur) => (cur === i ? null : cur))}
                style={styles.slot}
              >
                {body}
              </Pressable>
            );
          })}
        </View>
        {max > 0 && peakIndex >= 0 && active === null ? (
          <View
            pointerEvents="none"
            style={[
              styles.peakLabel,
              // Near the right edge, hang the label off the bar's left side so
              // it never collides with the gridline values column.
              peakIndex > points.length * 0.8 ? styles.peakLabelLeft : null,
              {
                left: `${((peakIndex + 0.5) / points.length) * 100}%`,
                top: height - px(max) - 18,
              },
            ]}
          >
            <Text variant="caption" tone="secondary">
              {compact(max)}
            </Text>
          </View>
        ) : null}
        {activePoint ? (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                backgroundColor: theme.bg.elevated,
                borderColor: theme.border.default,
                left: `${((Number(active) + 0.5) / points.length) * 100}%`,
                transform: [
                  { translateX: active !== null && active > points.length / 2 ? -140 : 0 },
                ],
              },
            ]}
          >
            <Text variant="caption" tone="muted">
              {labelFor(activePoint.day)}
            </Text>
            <Text variant="label">
              {activePoint.value.toLocaleString()}
              {segments ? " total" : ""}
            </Text>
            {segments?.map((s) => (
              <View key={s.key} style={styles.tooltipRow}>
                <View style={[styles.swatch, { backgroundColor: s.color }]} />
                <Text variant="caption" tone="secondary">
                  {s.label}: {(s.points[Number(active)]?.value ?? 0).toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.axis}>
        <Text variant="caption" tone="muted">
          {first ? shortDay(first.day) : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {middle && points.length > 2 ? shortDay(middle.day) : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {last ? shortDay(last.day) : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  // Top margin leaves room for the peak label when the peak touches the ceiling.
  plot: { position: "relative", width: "100%", marginTop: 20 },
  gridline: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-end",
  },
  gridLabel: { marginTop: -16, paddingRight: 2, width: 28, textAlign: "right" },
  bars: {
    position: "absolute",
    left: 0,
    right: 28,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  slot: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: GAP / 2,
  },
  bar: {
    width: "100%",
    maxWidth: MAX_BAR,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  stackColumn: { width: "100%", maxWidth: MAX_BAR, justifyContent: "flex-end" },
  segment: { width: "100%" },
  overlapColumn: {
    width: "100%",
    maxWidth: MAX_BAR,
    height: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  overlapBar: { position: "absolute", bottom: 0 },
  peakLabel: { position: "absolute", marginLeft: -20, width: 40, alignItems: "center" },
  peakLabelLeft: { marginLeft: -44, alignItems: "flex-end" },
  tooltip: {
    position: "absolute",
    top: 0,
    width: 140,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  tooltipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingRight: 28,
  },
});
