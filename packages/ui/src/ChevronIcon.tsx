import { View } from "react-native";
import { tokens } from "./theme";

export interface ChevronIconProps {
  direction?: "left" | "right";
  size?: number;
  color?: string;
}

// A chevron drawn from a single View (two borders of a square, rotated 45°),
// so row affordances and back buttons never fall back to a font's "›" / "‹".
export function ChevronIcon({
  direction = "right",
  size = 16,
  color = tokens.text.primary,
}: ChevronIconProps) {
  const stroke = Math.max(1.5, size * 0.11);
  const side = size * 0.55;
  const right = direction === "right";
  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View
        style={{
          width: side,
          height: side,
          borderTopWidth: stroke,
          borderRightWidth: right ? stroke : 0,
          borderLeftWidth: right ? 0 : stroke,
          borderColor: color,
          // Shift the glyph toward its point so it sits optically centred.
          marginLeft: right ? -side * 0.35 : side * 0.35,
          transform: [{ rotate: right ? "45deg" : "-45deg" }],
        }}
      />
    </View>
  );
}
