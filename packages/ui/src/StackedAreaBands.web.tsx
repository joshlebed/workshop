// Web renderer for `StackedAreaChart`'s bands: one anti-aliased SVG polygon
// per band, outlined in the surface color so neighbours stay separate.
// The native sibling draws the same geometry with plain Views.

import type { StackedAreaBandsProps } from "./StackedAreaBands";

export function StackedAreaBands({ width, height, bands, surface }: StackedAreaBandsProps) {
  if (width <= 0) return null;
  const last = (bands[0]?.upper.length ?? 1) - 1;
  const x = (i: number) => (last > 0 ? (i / last) * width : 0);
  const y = (fraction: number) => (1 - Math.min(1, fraction)) * height;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {bands.map((band) => {
        const top = band.upper.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        const bottom = band.lower.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
        return (
          <polygon
            key={band.key}
            points={[...top, ...bottom].join(" ")}
            fill={band.color}
            stroke={surface}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
