import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { tokens } from "./theme";

type Variant = "title" | "heading" | "body" | "caption" | "label";
type Tone = "primary" | "secondary" | "muted" | "onAccent" | "danger";

// Each variant carries its own line-height so vertical rhythm is correct by
// default (RN's auto line-height runs tight on large weights and made titles
// feel cramped). Titles also get a touch of negative tracking — large text
// reads tighter and more composed with letters pulled in slightly.
const variantStyle: Record<Variant, TextStyle> = {
  title: {
    fontSize: tokens.font.size.xxl,
    lineHeight: 34,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.4,
  },
  heading: {
    fontSize: tokens.font.size.lg,
    lineHeight: 24,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.2,
  },
  body: { fontSize: tokens.font.size.md, lineHeight: 22, fontWeight: tokens.font.weight.regular },
  caption: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.regular,
  },
  label: { fontSize: tokens.font.size.sm, lineHeight: 18, fontWeight: tokens.font.weight.medium },
};

const toneColor: Record<Tone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  onAccent: tokens.text.onAccent,
  danger: tokens.status.danger,
};

export interface UITextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: UITextProps) {
  return <RNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />;
}

// Reanimated-aware sibling: drop-in for `<Text>` when `style` needs to be an
// animated value (e.g. `useAnimatedStyle` opacity/transform). Raw
// `<Animated.Text>` would strip the `variant` / `tone` props; this preserves
// them and merges the animated style on top. See AGENT-REFLECTIONS.md
// 2026-04-28 (Phase 5d) for why this exists.
const AnimatedRNText = Animated.createAnimatedComponent(RNText);

type AnimatedRNTextProps = ComponentProps<typeof AnimatedRNText>;

export interface AnimatedUITextProps extends AnimatedRNTextProps {
  variant?: Variant;
  tone?: Tone;
}

export function AnimatedText({
  variant = "body",
  tone = "primary",
  style,
  ...rest
}: AnimatedUITextProps) {
  return (
    <AnimatedRNText {...rest} style={[variantStyle[variant], { color: toneColor[tone] }, style]} />
  );
}
