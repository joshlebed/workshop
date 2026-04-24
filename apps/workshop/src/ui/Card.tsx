import { View, type ViewProps, type ViewStyle } from "react-native";
import { tokens } from "./theme";

export interface CardProps extends ViewProps {
  elevated?: boolean;
  padded?: boolean;
}

export function Card({ elevated = false, padded = true, style, ...rest }: CardProps) {
  const computed: ViewStyle = {
    backgroundColor: elevated ? tokens.bg.elevated : tokens.bg.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    padding: padded ? tokens.space.lg : 0,
  };
  return <View {...rest} style={[computed, style]} />;
}
