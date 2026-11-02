import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { pixelType, tokens } from "./tokens";
import { bodyType, scoreType, uiType } from "./type";

type Variant =
  | "display"
  | "game"
  | "score"
  | "title"
  | "heading"
  | "overline"
  | "body"
  | "caption"
  | "label";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "link"
  | "success"
  | "spotlight";

// `display` (the wordmark), `game` (game names) and `score` (numerals) are
// the only pixel-face variants (DESIGN.md). Everything else is Space Grotesk:
// `title` (screen titles), `heading` (sheet titles, names, section headers),
// `overline` (the small uppercase UI label — TODAY, YOU, turnout, FIX/EDIT),
// `body` / `caption` / `label`. Sizes mirror the shared `@workshop/ui`
// variants so the restyle keeps today's hierarchy.
function variantStyle(v: Variant): TextStyle {
  switch (v) {
    case "display":
      return pixelType(24);
    case "game":
      return pixelType(13);
    case "score":
      return scoreType(14);
    case "title":
      return { ...bodyType("bold"), fontSize: 24, lineHeight: 30 };
    case "heading":
      return { ...bodyType("semibold"), fontSize: tokens.font.size.lg, lineHeight: 24 };
    case "overline":
      return uiType(11);
    case "body":
      return { ...bodyType(), fontSize: tokens.font.size.md, lineHeight: 22 };
    case "caption":
      return { ...bodyType(), fontSize: tokens.font.size.xs, lineHeight: 16 };
    case "label":
      return { ...bodyType("medium"), fontSize: tokens.font.size.sm, lineHeight: 18 };
  }
}

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  onAccent: tokens.text.onAccent,
  danger: tokens.status.danger,
  // Pink = tappable/interactive text. Tint variant for small sizes is the
  // caller's call (`tokens.neon.pinkTint`).
  link: tokens.neon.pink,
  // Chartreuse is earned: success, streaks, personal bests only.
  success: tokens.neon.chartreuse,
  // Yellow spotlights the leader / today / badges — never CTAs.
  spotlight: tokens.neon.yellow,
};

export interface HSTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: HSTextProps) {
  return <RNText {...rest} style={[variantStyle(variant), { color: toneColor[tone] }, style]} />;
}

// Reanimated-aware sibling: drop-in for `<Text>` when `style` needs to be an
// animated value. Raw `<Animated.Text>` would strip `variant` / `tone`.
const AnimatedRNText = Animated.createAnimatedComponent(RNText);

type AnimatedRNTextProps = ComponentProps<typeof AnimatedRNText>;

export interface HSAnimatedTextProps extends AnimatedRNTextProps {
  variant?: Variant;
  tone?: Tone;
}

export function AnimatedText({
  variant = "body",
  tone = "primary",
  style,
  ...rest
}: HSAnimatedTextProps) {
  return (
    <AnimatedRNText {...rest} style={[variantStyle(variant), { color: toneColor[tone] }, style]} />
  );
}
