// Hand-built pixel arcade cabinet, per DESIGN.md's brand-asset note: purple
// body on the dark ground, screen lit in neon. Drawn on a 16×16 grid of
// react-native-svg rects so it scales to any size without blurring the pixels.

import Svg, { Rect } from "react-native-svg";
import { tokens } from "../theme";

interface BrandIconProps {
  size: number;
}

const P = tokens.neon.pink;
const Y = tokens.neon.yellow;
const C = tokens.neon.chartreuse;

export function BrandIcon({ size }: BrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      {/* cabinet body + plinth */}
      <Rect x={3} y={1} width={10} height={14} fill={tokens.bg.raised} />
      <Rect x={2} y={13} width={12} height={3} fill={tokens.bg.elevated} />
      {/* lit marquee */}
      <Rect x={4} y={2} width={8} height={1} fill={P} />
      {/* screen */}
      <Rect x={4} y={4} width={8} height={5} fill={tokens.bg.canvas} />
      <Rect x={5} y={5} width={1} height={1} fill={Y} />
      <Rect x={7} y={5} width={1} height={1} fill={Y} />
      <Rect x={9} y={5} width={1} height={1} fill={Y} />
      <Rect x={6} y={7} width={1} height={1} fill={C} />
      <Rect x={8} y={7} width={2} height={1} fill={P} />
      {/* control panel */}
      <Rect x={4} y={10} width={8} height={2} fill={tokens.bg.elevated} />
      <Rect x={5} y={10} width={1} height={1} fill={P} />
      <Rect x={7} y={10} width={1} height={1} fill={Y} />
    </Svg>
  );
}
