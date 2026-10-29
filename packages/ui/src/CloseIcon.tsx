import { View } from "react-native";
import { tokens } from "./theme";

export interface CloseIconProps {
  size?: number;
  color?: string;
}

// Two bars crossed at 45° — the "close" glyph, drawn from plain Views (like
// `CopyIcon`) so a dismiss affordance never depends on a font's letter x.
export function CloseIcon({ size = 16, color = tokens.text.primary }: CloseIconProps) {
  const stroke = Math.max(1.5, size * 0.11);
  const length = size * 0.95;
  const bar = {
    position: "absolute" as const,
    width: length,
    height: stroke,
    borderRadius: stroke / 2,
    backgroundColor: color,
  };
  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View style={[bar, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
    </View>
  );
}
