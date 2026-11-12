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
const { size, lineHeight, tracking, weight } = tokens.font;

const variantStyle: Record<Variant, TextStyle> = {
  display: {
    fontSize: size.xxxl,
    lineHeight: lineHeight.xxxl,
    fontWeight: weight.bold,
    letterSpacing: tracking.display,
  },
  title: {
    fontSize: size.xxl,
    lineHeight: lineHeight.xxl,
    fontWeight: weight.semibold,
    letterSpacing: tracking.title,
  },
  heading: {
    fontSize: size.lg,
    lineHeight: lineHeight.lg,
    fontWeight: weight.semibold,
    letterSpacing: tracking.heading,
  },
  body: { fontSize: size.md, lineHeight: lineHeight.md, fontWeight: weight.regular },
  caption: { fontSize: size.xs, lineHeight: lineHeight.xs, fontWeight: weight.regular },
  label: { fontSize: size.sm, lineHeight: lineHeight.sm, fontWeight: weight.medium },
  // Section labels and kickers: small, uppercase, tracked. Defaults to the
  // muted tone (see `defaultTone`).
  eyebrow: {
    fontSize: size.xs,
    lineHeight: lineHeight.xs,
    fontWeight: weight.semibold,
    letterSpacing: tracking.eyebrow,
    textTransform: "uppercase",
  },
};

// Headings announce themselves to assistive tech: `title` and `display` are
// level 1, `heading` level 2. Pass `headerRole={false}` for text that only
// borrows the look (a big number, a hero line that isn't a heading), or a
// level (`headerRole={1}`) when the outline needs a different one than the
// look implies: a screen's one level-1 heading set in `heading` size.
const headingLevel: Partial<Record<Variant, number>> = { display: 1, title: 1, heading: 2 };

type HeaderRole = boolean | 1 | 2 | 3;

function roleProps(variant: Variant, headerRole: HeaderRole | undefined) {
  const level = typeof headerRole === "number" ? headerRole : headingLevel[variant];
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
  /**
   * `title` / `display` are level-1 headings and `heading` level 2; `false`
   * opts out, a number sets the level.
   */
  headerRole?: HeaderRole;
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
  headerRole?: HeaderRole;
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
