// The mark: a pixel-art upright arcade cabinet (DESIGN.md "Brand assets"),
// drawn on a 16×16 grid so it stays crisp at every size we render it — the
// shelf key at 24, the shelf title at 28, the sign-in screen at 56.
//
// Hand-drawn as rects rather than a raster asset: the cabinet has to tint
// with the palette (lit screen in pink, marquee in yellow) and a PNG can't.

import Svg, { Rect } from "react-native-svg";
import { palette } from "../theme/tokens";

interface BrandIconProps {
  size: number;
}

const U = 1; // one pixel on the 16-unit grid

export function BrandIcon({ size }: BrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      {/* Cabinet body + bezel */}
      <Rect x={2} y={1} width={12} height={13} fill={palette.surface3} />
      <Rect x={2} y={1} width={12} height={U} fill={palette.border} />
      <Rect x={2} y={1} width={U} height={13} fill={palette.border} />
      <Rect x={13} y={1} width={U} height={13} fill={palette.border} />
      {/* Marquee */}
      <Rect x={4} y={2} width={8} height={U} fill={palette.accent} />
      {/* Screen */}
      <Rect x={4} y={4} width={8} height={5} fill={palette.bg} />
      {/* Lit screen pixels — a tiny leaderboard */}
      <Rect x={5} y={5} width={4} height={U} fill={palette.primary} />
      <Rect x={5} y={6} width={6} height={U} fill={palette.primary} />
      <Rect x={5} y={7} width={3} height={U} fill={palette.success} />
      {/* Control panel: stick + two buttons */}
      <Rect x={5} y={11} width={U} height={U} fill={palette.textSecondary} />
      <Rect x={8} y={11} width={U} height={U} fill={palette.primary} />
      <Rect x={10} y={11} width={U} height={U} fill={palette.accent} />
      {/* Legs */}
      <Rect x={3} y={14} width={2} height={2} fill={palette.border} />
      <Rect x={11} y={14} width={2} height={2} fill={palette.border} />
    </Svg>
  );
}
