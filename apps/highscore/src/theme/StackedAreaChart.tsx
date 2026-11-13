// Stacked area chart for the admin analytics dashboards: one band per series
// over daily (or weekly) points, e.g. users per app version. No chart
// library: the bands are drawn by `StackedAreaBands` (SVG on web, plain
// Views on native, so iOS needs no native module).
//
// Follows the dataviz mark spec: a hairline surface gap between bands,
// recessive gridlines, a legend (always, since there are several series)
// plus a direct label on each band still present at the right edge when the
// chart is wide enough, a crosshair + tooltip on hover/press, and text in
// text tokens only. Colors are the validated dark categorical palette,
// assigned in stack order.

import { useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { type StackedAreaBand, StackedAreaBands } from "./StackedAreaBands";
import { Text } from "./Text";
import { tokens as theme } from "./tokens";

export interface StackedAreaSegment {
  key: string;
  label: string;
  /** `day` is `YYYY-MM-DD` (UTC); every segment has the same days in the same order. */
  points: { day: string; value: number }[];
}

export interface StackedAreaChartProps {
  /** Bands in stack order, bottom first. Twelve colors before they repeat. */
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
// The last four are lighter tints of blue / yellow / violet / green for a
// chart with more than eight bands, ordered so neighbours stay ≥17 ΔE apart;
// they repeat a hue, so the legend, direct labels and tooltip carry identity.
const SERIES_COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
  "#88b7ef",
  "#dfb666",
  "#bcb6f2",
  "#66b566",
];
// HighScore cards are transparent, so the surface behind a band is the canvas.
const SURFACE = theme.bg.canvas;

const PLOT_HEIGHT = 180;
/** Left gutter holding the y-axis values. */
const AXIS = 40;
/** Right gutter holding the direct band labels, on charts at least `LABELS_FROM` wide. */
const LABELS = 132;
const LABELS_FROM = 620;
/** A band gets a direct label only when it is at least this tall at the right edge. */
const LABEL_MIN_BAND = 15;
const TOOLTIP_WIDTH = 200;
const TICK_WIDTH = 56;
// Drawn over the bands, so it has to read on both a fill and the surface.
const GRIDLINE = "rgba(255,255,255,0.22)";

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
  const [rootWidth, setRootWidth] = useState(0);
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

  // Cumulative edges per band. A single point is doubled so it still spans
  // the plot as a flat band.
  const bands = useMemo<StackedAreaBand[]>(() => {
    const running = days.map(() => 0);
    return segments.map((s, index) => {
      const lower = [...running];
      const upper = running.map((base, i) => base + (fractions[index]?.[i] ?? 0));
      upper.forEach((v, i) => {
        running[i] = v;
      });
      const span = (edge: number[]) => (edge.length === 1 ? [...edge, ...edge] : edge);
      return {
        key: s.key,
        color: SERIES_COLORS[index % SERIES_COLORS.length] ?? theme.text.secondary,
        lower: span(lower),
        upper: span(upper),
      };
    });
  }, [segments, days, fractions]);

  const showLabels = rootWidth >= LABELS_FROM;
  const width = Math.max(0, rootWidth - AXIS - (showLabels ? LABELS : 0));
  const onLayout = (e: LayoutChangeEvent) => setRootWidth(Math.floor(e.nativeEvent.layout.width));

  if (segments.length === 0 || totals.every((t) => t === 0)) {
    return (
      <Text variant="caption" tone="muted" testID={testID}>
        No data yet.
      </Text>
    );
  }

  const labelFor = (day: string) =>
    bucket === "week" ? `Week of ${shortDay(day)}` : shortDay(day);
  const colorOf = (index: number) => bands[index]?.color ?? theme.text.secondary;
  // Evenly spaced date ticks, always including the first and last point.
  const tickCount = Math.min(n, width >= 480 ? 6 : 3);
  const ticks = [
    ...new Set(
      Array.from({ length: tickCount }, (_, k) =>
        tickCount > 1 ? Math.round((k * (n - 1)) / (tickCount - 1)) : 0,
      ),
    ),
  ];
  // Direct labels for the bands still present at the right edge.
  const endLabels = showLabels
    ? bands.flatMap((band, index) => {
        const top = band.upper[band.upper.length - 1] ?? 0;
        const bottom = band.lower[band.lower.length - 1] ?? 0;
        if ((top - bottom) * height < LABEL_MIN_BAND) return [];
        return [
          { index, label: segments[index]?.label ?? "", y: (1 - (top + bottom) / 2) * height },
        ];
      })
    : [];
  const xOf = (index: number) => (n > 1 ? (index / (n - 1)) * width : width / 2);
  const activeDay = active !== null ? days[active] : undefined;
  const activeTotal = active !== null ? (totals[active] ?? 0) : 0;
  const gridLabel = (fraction: number) =>
    mode === "share" ? `${fraction * 100}%` : String(ceiling * fraction);

  return (
    <View testID={testID} style={styles.root} onLayout={onLayout}>
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
        <View style={[styles.area, { width }]}>
          <StackedAreaBands width={width} height={height} bands={bands} surface={SURFACE} />
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
        {/* Recessive gridlines at ½ / max, labelled in the left gutter. */}
        {[1, 0.5, 0].map((fraction) =>
          mode === "share" || Number.isInteger(ceiling * fraction) ? (
            <View
              key={fraction}
              pointerEvents="none"
              style={[styles.gridRow, { top: height * (1 - fraction) }]}
            >
              <Text variant="caption" tone="muted" style={styles.gridLabel}>
                {gridLabel(fraction)}
              </Text>
              <View
                style={[
                  styles.gridline,
                  {
                    width,
                    borderTopColor: fraction === 0 ? theme.border.default : GRIDLINE,
                  },
                ]}
              />
            </View>
          ) : null,
        )}
        {endLabels.map((e) => (
          <View
            key={segments[e.index]?.key ?? e.index}
            pointerEvents="none"
            style={[styles.endLabel, { left: AXIS + width + 8, top: e.y - 8 }]}
          >
            <View style={[styles.swatch, { backgroundColor: colorOf(e.index) }]} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.endLabelText}>
              {e.label}
            </Text>
          </View>
        ))}
        {activeDay && active !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                left: AXIS + xOf(active),
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
        {ticks.map((i) => (
          <Text
            key={i}
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={[
              styles.tick,
              i === 0
                ? { left: AXIS, textAlign: "left" }
                : i === n - 1
                  ? { left: AXIS + width - TICK_WIDTH, textAlign: "right" }
                  : { left: AXIS + xOf(i) - TICK_WIDTH / 2 },
            ]}
          >
            {shortDay(days[i] ?? "")}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, marginBottom: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: theme.radius.sm },
  plot: { position: "relative", width: "100%", marginTop: 20 },
  area: { position: "absolute", left: AXIS, top: 0, bottom: 0, overflow: "hidden" },
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
  gridRow: { position: "absolute", left: 0, flexDirection: "row", alignItems: "center", height: 0 },
  gridLabel: { width: AXIS, paddingRight: 6, textAlign: "right" },
  gridline: { borderTopWidth: 1 },
  endLabel: {
    position: "absolute",
    width: LABELS - 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  endLabelText: { flexShrink: 1 },
  tooltip: {
    position: "absolute",
    top: 0,
    width: TOOLTIP_WIDTH,
    padding: 6,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: 2,
    backgroundColor: theme.bg.elevated,
    borderColor: theme.border.default,
  },
  tooltipRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  axis: { position: "relative", height: 16, marginTop: 6 },
  tick: { position: "absolute", top: 0, width: TICK_WIDTH, textAlign: "center" },
});
