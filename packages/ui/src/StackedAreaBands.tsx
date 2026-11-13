// Native renderer for `StackedAreaChart`'s bands, with no SVG dependency (so
// it ships by OTA): the plot is cut into 1px columns and each column draws
// the bands at heights interpolated between the two nearest points. Web has
// an SVG sibling (`.web.tsx`) that draws the same geometry anti-aliased.

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

export interface StackedAreaBand {
  key: string;
  color: string;
  /** Bottom and top edge at each point, as fractions of the plot height. */
  lower: number[];
  upper: number[];
}

export interface StackedAreaBandsProps {
  width: number;
  height: number;
  /** Bottom band first; every band has the same number of points (≥ 2). */
  bands: StackedAreaBand[];
  /** The color behind the chart, used to separate neighbouring bands. */
  surface: string;
}

export function StackedAreaBands({ width, height, bands }: StackedAreaBandsProps) {
  const columns = useMemo(() => {
    const last = (bands[0]?.upper.length ?? 1) - 1;
    if (width <= 0 || last < 1) return [];
    return Array.from({ length: Math.ceil(width) }, (_, c) => {
      const t = Math.min(1, (c + 0.5) / width) * last;
      const i0 = Math.min(Math.floor(t), last - 1);
      const f = t - i0;
      let previousPx = 0;
      return bands.map((band) => {
        const a = band.upper[i0] ?? 0;
        const b = band.upper[i0 + 1] ?? a;
        const boundary = Math.round(Math.min(1, a + (b - a) * f) * height);
        const h = Math.max(0, boundary - previousPx);
        previousPx = Math.max(previousPx, boundary);
        return h;
      });
    });
  }, [width, height, bands]);

  return (
    <>
      {columns.map((heights, c) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional slices of the plot.
          key={c}
          pointerEvents="none"
          style={[styles.column, { left: c }]}
        >
          {heights.map((h, s) =>
            h > 0 ? (
              <View
                key={bands[s]?.key ?? s}
                style={{ height: h, backgroundColor: bands[s]?.color }}
              />
            ) : null,
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  column: { position: "absolute", bottom: 0, width: 1, flexDirection: "column-reverse" },
});
