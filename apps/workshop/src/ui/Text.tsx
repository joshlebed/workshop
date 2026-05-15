import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { tokens } from "./theme";

type Variant = "title" | "heading" | "body" | "caption" | "label";
type Tone = "primary" | "secondary" | "muted" | "onAccent" | "danger";

const variantStyle: Record<Variant, TextStyle> = {
  title: { fontSize: tokens.font.size.xxl, fontWeight: tokens.font.weight.semibold },
  heading: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.semibold },
  body: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.regular },
  caption: { fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.regular },
  label: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.medium },
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
