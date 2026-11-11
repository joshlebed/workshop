import type { ComponentProps } from "react";
import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import Animated from "react-native-reanimated";
import { webAria } from "./interaction";
import { tokens } from "./theme";

type Variant = "display" | "title" | "heading" | "body" | "caption" | "label" | "eyebrow";
type Tone = "primary" | "secondary" | "muted" | "onAccent" | "danger";

// Each variant carries its own line-height so vertical rhythm is correct by
// default (RN's auto line-height runs tight on large weights and made titles
// feel cramped). Titles also get a touch of negative tracking — large text
// reads tighter and more composed with letters pulled in slightly.
const variantStyle: Record<Variant, TextStyle> = {
  display: {
    fontSize: tokens.font.size.xxxl,
    lineHeight: 40,
    fontWeight: tokens.font.weight.bold,
    letterSpacing: -0.6,
  },
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
  // Section labels and kickers: small, uppercase, tracked. Defaults to the
  // muted tone (see `defaultTone`).
  eyebrow: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
};

// Headings announce themselves to assistive tech: `title` and `display` are
// level 1, `heading` level 2. Pass `headerRole={false}` for text that only
// borrows the look (a big number, a hero line that isn't a heading).
const headingLevel: Partial<Record<Variant, number>> = { display: 1, title: 1, heading: 2 };

function roleProps(variant: Variant, headerRole: boolean | undefined) {
  const level = headingLevel[variant];
  if (!level || headerRole === false) return {};
  return { accessibilityRole: "header" as const, ...webAria({ "aria-level": level }) };
}

function defaultTone(variant: Variant): Tone {
  return variant === "eyebrow" ? "muted" : "primary";
}

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
  /** `title` / `heading` / `display` carry the header role; `false` opts out. */
  headerRole?: boolean;
}

export function Text({ variant = "body", tone, headerRole, style, ...rest }: UITextProps) {
  return (
    <RNText
      {...roleProps(variant, headerRole)}
      {...rest}
      style={[variantStyle[variant], { color: toneColor[tone ?? defaultTone(variant)] }, style]}
    />
  );
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
  headerRole?: boolean;
}

export function AnimatedText({
  variant = "body",
  tone,
  headerRole,
  style,
  ...rest
}: AnimatedUITextProps) {
  return (
    <AnimatedRNText
      {...roleProps(variant, headerRole)}
      {...rest}
      style={[variantStyle[variant], { color: toneColor[tone ?? defaultTone(variant)] }, style]}
    />
  );
}
