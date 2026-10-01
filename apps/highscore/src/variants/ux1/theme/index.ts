// HighScore theme barrel — the only place HighScore code gets visual tokens
// and themed primitives. See apps/highscore/DESIGN.md.
export { Avatar, type AvatarProps } from "./Avatar";
export { Button, type ButtonProps } from "./Button";
export { Card, type CardProps } from "./Card";
export { Chip, type ChipProps } from "./Chip";
export { IconButton, type IconButtonProps } from "./IconButton";
export { GutterRow, Screen, screenColumnMaxWidth } from "./layout";
export { stepped, zoomStepped } from "./motion";
export { Notice, type NoticeProps } from "./Notice";
export { PixelIcon, type PixelIconName, type PixelIconProps } from "./PixelIcon";
export { Sheet, type SheetProps } from "./Sheet";
export { AnimatedText, type HSTextProps, Text } from "./Text";
export { ToastProvider, useToast } from "./Toast";
export {
  deck,
  glow,
  PIXEL_FONT,
  palette,
  pixelType,
  STEP_DURATION_MS,
  type Tokens,
  textGlow,
  tokens,
} from "./tokens";
