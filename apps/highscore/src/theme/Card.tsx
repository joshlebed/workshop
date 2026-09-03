import { View, type ViewProps, type ViewStyle } from "react-native";
import { tokens } from "./tokens";

export interface CardProps extends ViewProps {
  /** Filled variant (surface.2) — reserve for inputs and sheet-like content. */
  elevated?: boolean;
  padded?: boolean;
}

/**
 * A framed block: 2px bezel on the dark ground rather than a lighter fill, so
 * cards read as thin frames in a dark room. Sharp corners, no drop shadows.
 */
export function Card({ elevated = false, padded = true, style, ...rest }: CardProps) {
  const computed: ViewStyle = {
    backgroundColor: elevated ? tokens.bg.elevated : "transparent",
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    padding: padded ? tokens.space.md : 0,
  };
  return <View {...rest} style={[computed, style]} />;
}
