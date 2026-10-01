import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { MONO_FONT, pixelType, tokens } from "./tokens";

type Variant =
  | "display"
  | "title"
  | "heading"
  | "score"
  | "cell"
  | "body"
  | "caption"
  | "label"
  | "eyebrow"
  | "mono";
type Tone =
  | "primary"
  | "secondary"
  | "muted"
  | "onAccent"
  | "danger"
  | "link"
  | "success"
  | "spotlight";

// display/title/heading/score/cell render in Press Start 2P (ALL CAPS,
// generous line height — the face clips tight line boxes); body/caption/label
// stay on the system face per DESIGN.md ("pixel type is for headings + scores
// only"). The scale is deliberately gapped — 10, 13, 18, 24 — so hierarchy
// reads at a glance with nothing in the mushy middle.
const variantStyle: Record<Variant, TextStyle> = {
  display: pixelType(24),
  title: pixelType(18),
  heading: pixelType(13),
  /** Hero numerals. Override `fontSize` freely; they go to 40+. */
  score: pixelType(18),
  /** The matrix cell numeral — smallest legible pixel size. */
  cell: pixelType(10, 1.4),
  body: { fontSize: tokens.font.size.md, lineHeight: 22, fontWeight: tokens.font.weight.regular },
  caption: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.regular,
  },
  label: { fontSize: tokens.font.size.sm, lineHeight: 18, fontWeight: tokens.font.weight.medium },
  /** Small all-caps section marker. Not pixel: eyebrows shouldn't shout. */
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: tokens.font.weight.semibold,
  },
  mono: { fontFamily: MONO_FONT, fontSize: tokens.font.size.sm, lineHeight: 19 },
};

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.secondary,
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
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
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
  return (
    <AnimatedRNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />
  );
}
