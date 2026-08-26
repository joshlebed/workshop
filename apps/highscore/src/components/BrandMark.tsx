import { tokens } from "@workshop/ui";
import { View } from "react-native";

const SCORE_GRID = [
  {
    key: "top",
    cells: [
      { key: "top-left", active: false },
      { key: "top-center", active: true },
      { key: "top-right", active: true },
    ],
  },
  {
    key: "middle",
    cells: [
      { key: "middle-left", active: false },
      { key: "middle-center", active: true },
      { key: "middle-right", active: true },
    ],
  },
  {
    key: "bottom",
    cells: [
      { key: "bottom-left", active: true },
      { key: "bottom-center", active: true },
      { key: "bottom-right", active: false },
    ],
  },
] as const;

interface BrandMarkProps {
  size?: number;
}

/**
 * A rising score line built from the grid people already share after playing.
 * It stays as Views so the same mark renders crisply on web and native without
 * adding an SVG runtime dependency.
 */
export function BrandMark({ size = 24 }: BrandMarkProps) {
  const gap = Math.max(2, Math.round(size / 12));
  const cell = (size - gap * 2) / 3;
  const radius = Math.max(1, Math.round(cell * 0.2));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, gap }}
    >
      {SCORE_GRID.map((row) => (
        <View key={row.key} style={{ flexDirection: "row", gap }}>
          {row.cells.map((cellValue) => (
            <View
              key={cellValue.key}
              style={{
                width: cell,
                height: cell,
                borderRadius: radius,
                backgroundColor: cellValue.active ? tokens.accent.default : tokens.border.default,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
