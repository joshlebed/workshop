// HighScore's app-owned theme layer (DESIGN.md). Import visual tokens and
// restyled primitives from here, never from @workshop/ui.

export { Button, type HSButtonProps } from "./Button";
export { MarqueeHeader } from "./Marquee";
export { PixelIcon, type PixelIconName } from "./PixelIcon";
export { type HSTextProps, Text } from "./Text";
export { type HsTokens, hs, tokens } from "./tokens";

import type { ViewStyle } from "react-native";
import { hs } from "./tokens";

/** Pass as `contentStyle` to the shared Sheet: purple surface, sharp top, bezel. */
export const sheetContentStyle: ViewStyle = {
  backgroundColor: hs.color.surface1,
  borderTopLeftRadius: hs.radius,
  borderTopRightRadius: hs.radius,
  borderTopWidth: hs.bezel,
  borderColor: hs.color.border,
};
