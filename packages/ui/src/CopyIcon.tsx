import { View } from "react-native";
import { tokens } from "./theme";

export interface CopyIconProps {
  size?: number;
  color?: string;
}

// Two stacked rounded squares — the classic "copy" glyph. Drawn from plain
// Views so we don't pull in react-native-svg for one icon. The back layer is
// an L-shape (top + right borders only) so we don't need to know the parent's
// background color to occlude it behind the front square.
export function CopyIcon({ size = 16, color = tokens.text.primary }: CopyIconProps) {
  const stroke = Math.max(1.25, size * 0.09);
  const radius = Math.max(1.5, size * 0.14);
  const square = size * 0.7;

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: square,
          height: square,
          borderTopWidth: stroke,
          borderRightWidth: stroke,
          borderTopRightRadius: radius,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: square,
          height: square,
          borderWidth: stroke,
          borderRadius: radius,
          borderColor: color,
        }}
      />
    </View>
  );
}
