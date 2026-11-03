import { useMemo } from "react";
import { View } from "react-native";
import { PIXEL_ICON_PATHS } from "./pixelIconPaths";
import { PIXEL_GRID, type PixelRect, rasterizePixelIcon } from "./pixelIconRaster";
import { tokens } from "./tokens";

export type PixelIconName = keyof typeof PIXEL_ICON_PATHS;

export interface PixelIconProps {
  name: PixelIconName;
  /** Stay on the 24px grid (16/24/32) — fractional scaling blurs the pixels. */
  size?: 16 | 24 | 32;
  /** `text.secondary` at rest, `primary` pink when active/selected. */
  color?: string;
}

const rasterCache = new Map<PixelIconName, PixelRect[]>();

function rectsFor(name: PixelIconName): PixelRect[] {
  let rects = rasterCache.get(name);
  if (!rects) {
    rects = rasterizePixelIcon(PIXEL_ICON_PATHS[name]);
    rasterCache.set(name, rects);
  }
  return rects;
}

export function PixelIcon({ name, size = 24, color = tokens.text.secondary }: PixelIconProps) {
  const rects = useMemo(() => rectsFor(name), [name]);
  const unit = size / PIXEL_GRID;
  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {rects.map((r) => (
        <View
          key={`${r.x},${r.y}`}
          style={{
            position: "absolute",
            left: r.x * unit,
            top: r.y * unit,
            width: r.w * unit,
            height: r.h * unit,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}
