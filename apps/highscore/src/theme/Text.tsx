import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { pixelType, tokens } from "./tokens";
import { bodyType, scoreType, type TypeLab, uiType, useTypeLab } from "./typeLab";

type Variant = "display" | "game" | "title" | "heading" | "score" | "body" | "caption" | "label";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "link"
  | "success"
  | "spotlight";

// display/title/heading/score render in Press Start 2P (ALL CAPS, generous
// line height — the face clips tight line boxes); body/caption/label stay on
// the system face per DESIGN.md ("pixel type is for headings + scores only").
function variantStyle(v: Variant, lab: TypeLab): TextStyle {
  switch (v) {
    // Pixel face is reserved for the brand mark and game names (decision log
    // entry 8); everything else renders in the secondary face from the lab.
    case "display":
      return pixelType(24);
    case "game":
      return pixelType(13);
    case "title":
      return { ...bodyType(lab, "bold"), fontSize: 20, lineHeight: 26 };
    case "heading":
      return uiType(lab, 11);
    case "score":
      return scoreType(lab, 14);
    case "body":
      return { ...bodyType(lab), fontSize: tokens.font.size.md, lineHeight: 22 };
    case "caption":
      return { ...bodyType(lab), fontSize: tokens.font.size.xs, lineHeight: 16 };
    case "label":
      return { ...bodyType(lab, "medium"), fontSize: tokens.font.size.sm, lineHeight: 18 };
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
  const lab = useTypeLab();
  return (
    <RNText {...rest} style={[variantStyle(variant, lab), { color: toneColor[tone] }, style]} />
  );
}

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
  const lab = useTypeLab();
  return (
    <AnimatedRNText
      {...rest}
      style={[variantStyle(variant, lab), { color: toneColor[tone] }, style]}
    />
  );
}
