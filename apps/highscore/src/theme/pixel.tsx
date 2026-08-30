// v4 "Chunky Pixel" construction primitives. Everything here is stepped
// geometry — nested Views and hard borders — never rounding, never texture.
//
// The notched corner: a square overlay the color of the surface *behind* the
// card sits on each corner (cutting it off in a one-pixel step), and carries
// 2px inner borders that continue the card's bezel around the step. Corner
// radius stays 0 throughout.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from "react-native";
import { HsText } from "./HsText";
import { hsBezel, hsColor, hsGlow, hsMotion, hsSpace } from "./tokens";

const NOTCH = 7;

interface PixelCornersProps {
  /** Color of the surface behind the card — what the cut corner reveals. */
  cutColor: string;
  /** Bezel color to continue around the step. */
  bezelColor: string;
  size?: number;
}

/** Four absolutely-positioned corner cuts. Parent needs no special setup. */
export function PixelCorners({ cutColor, bezelColor, size = NOTCH }: PixelCornersProps) {
  const base: ViewStyle = {
    position: "absolute",
    width: size,
    height: size,
    backgroundColor: cutColor,
  };
  const b = hsBezel;
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          base,
          { top: 0, left: 0, borderRightWidth: b, borderBottomWidth: b, borderColor: bezelColor },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          base,
          { top: 0, right: 0, borderLeftWidth: b, borderBottomWidth: b, borderColor: bezelColor },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          base,
          { bottom: 0, left: 0, borderRightWidth: b, borderTopWidth: b, borderColor: bezelColor },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          base,
          { bottom: 0, right: 0, borderLeftWidth: b, borderTopWidth: b, borderColor: bezelColor },
        ]}
      />
    </>
  );
}

export interface PixelCardProps {
  children: ReactNode;
  /** Cut pixel-step corners (hero cards). Plain cards keep square corners. */
  notched?: boolean;
  /** Surface behind the card, revealed by the notch. Defaults to app bg. */
  cutColor?: string;
  surface?: "surface1" | "surface2" | "surface3";
  style?: ViewStyle;
  testID?: string;
}

/** Sharp-cornered card: purple surface, 2px bezel, optional notched corners. */
export function PixelCard({
  children,
  notched = false,
  cutColor = hsColor.bg,
  surface = "surface1",
  style,
  testID,
}: PixelCardProps) {
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: hsColor[surface],
          borderWidth: hsBezel,
          borderColor: hsColor.border,
        },
        style,
      ]}
    >
      {children}
      {notched ? <PixelCorners cutColor={cutColor} bezelColor={hsColor.border} /> : null}
    </View>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface PixelButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: ReactNode;
  /** Behind-the-button color revealed by the notch (primary/danger only). */
  cutColor?: string;
  testID?: string;
  style?: ViewStyle;
}

// Primary CTA press feedback: a stepped 2-frame glow "blink" — glow surges,
// cuts to nothing, then settles back. Hard steps on a timer, no easing.
function useGlowBlink(active: boolean): 0 | 1 | 2 {
  const [frame, setFrame] = useState<0 | 1 | 2>(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    if (!active) {
      setFrame(0);
      return;
    }
    setFrame(1);
    timers.current.push(setTimeout(() => setFrame(2), hsMotion.fast));
    timers.current.push(setTimeout(() => setFrame(0), hsMotion.fast * 2));
    return () => {
      for (const t of timers.current) clearTimeout(t);
    };
  }, [active]);
  return frame;
}

export function PixelButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  leftIcon,
  cutColor = hsColor.bg,
  testID,
  style,
  ...rest
}: PixelButtonProps) {
  const isDisabled = disabled || loading;
  const [pressed, setPressed] = useState(false);
  const blinkFrame = useGlowBlink(pressed && variant === "primary" && !isDisabled);

  const fill: Record<ButtonVariant, string> = {
    primary: pressed ? hsColor.primaryTint : hsColor.primary,
    secondary: pressed ? hsColor.surface3 : hsColor.surface2,
    ghost: pressed ? hsColor.surface2 : "transparent",
    danger: hsColor.danger,
  };
  const bezel: Record<ButtonVariant, string> = {
    primary: pressed ? hsColor.primaryTint : hsColor.primary,
    secondary: hsColor.border,
    ghost: "transparent",
    danger: hsColor.danger,
  };
  const labelTone = isDisabled
    ? "secondary"
    : variant === "primary" || variant === "danger"
      ? "onNeon"
      : variant === "ghost"
        ? "pink"
        : "primary";

  // Glow (primary only): base glow at rest, surge on blink frame 1, dark on
  // frame 2 — the arcade attract-mode flicker.
  const glow =
    variant === "primary" && !isDisabled
      ? blinkFrame === 1
        ? hsGlow.primaryStrong
        : blinkFrame === 2
          ? undefined
          : hsGlow.primary
      : undefined;

  const notched = variant === "primary" || variant === "danger";
  // Press Start 2P for short labels only (≥12px per brief); long labels fall
  // back to system semibold so they stay readable.
  const pixelLabel = label.length <= 16;

  return (
    <Pressable
      {...rest}
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        btnStyles.base,
        size === "lg" ? btnStyles.lg : btnStyles.md,
        {
          backgroundColor: isDisabled && variant !== "ghost" ? hsColor.surface2 : fill[variant],
          borderColor: isDisabled && variant !== "ghost" ? hsColor.border : bezel[variant],
        },
        glow ? ({ boxShadow: glow } as ViewStyle) : null,
        style,
      ]}
    >
      {loading ? (
        <HsText variant="pixelLabel" tone={variant === "ghost" ? "pink" : "onNeon"}>
          ···
        </HsText>
      ) : (
        <>
          {leftIcon}
          {pixelLabel ? (
            <HsText variant="pixelLabel" tone={labelTone} style={btnStyles.pixelLabel}>
              {label}
            </HsText>
          ) : (
            <HsText variant="label" tone={labelTone} style={btnStyles.sysLabel}>
              {label}
            </HsText>
          )}
        </>
      )}
      {notched && !isDisabled ? (
        <PixelCorners cutColor={cutColor} bezelColor={bezel[variant]} size={5} />
      ) : null}
    </Pressable>
  );
}

const btnStyles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: hsSpace.sm,
    borderWidth: hsBezel,
    borderRadius: 0,
  },
  md: { paddingVertical: 12, paddingHorizontal: hsSpace.lg, minHeight: 44 },
  lg: { paddingVertical: 16, paddingHorizontal: hsSpace.xl, minHeight: 52 },
  pixelLabel: { fontSize: 12, lineHeight: 19 },
  sysLabel: { fontWeight: "600" },
});

const DIVIDER_BLOCKS = Array.from({ length: 48 }, (_, i) => ({
  key: `block-${i}`,
  bright: i % 3 === 0,
}));

/** Chunky pixel-block divider row between sections. Structure, not texture. */
export function PixelDivider({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[dividerStyles.row, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {DIVIDER_BLOCKS.map((block) => (
        <View
          key={block.key}
          style={[
            dividerStyles.block,
            { backgroundColor: block.bright ? hsColor.border : hsColor.surface2 },
          ]}
        />
      ))}
    </View>
  );
}

const dividerStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    height: 6,
    overflow: "hidden",
    alignSelf: "stretch",
  },
  block: { width: 6, height: 6 },
});

export interface PixelBadgeProps {
  label: string;
  /**
   * Spotlight badge color. `accent` (neon yellow) marks the leader / "today";
   * `success` celebrates. Yellow marks what to LOOK at, never what to tap.
   */
  tone?: "accent" | "success";
  /** Reserved-glow moments only (leader crown, celebration). */
  glow?: boolean;
  testID?: string;
  style?: ViewStyle;
}

export function PixelBadge({
  label,
  tone = "accent",
  glow = false,
  testID,
  style,
}: PixelBadgeProps) {
  const fill = tone === "accent" ? hsColor.accent : hsColor.success;
  const glowShadow = tone === "accent" ? hsGlow.accent : hsGlow.success;
  return (
    <View
      testID={testID}
      style={[
        badgeStyles.base,
        { backgroundColor: fill },
        glow ? ({ boxShadow: glowShadow } as ViewStyle) : null,
        style,
      ]}
    >
      <HsText variant="pixelLabel" tone="onNeon" style={badgeStyles.text}>
        {label}
      </HsText>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 0,
  },
  text: { fontSize: 10, lineHeight: 13, letterSpacing: 1 },
});
