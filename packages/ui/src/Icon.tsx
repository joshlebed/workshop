import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { tokens } from "./theme";

// One icon set, drawn from plain Views (borders, bars, circles), so control
// glyphs never depend on a platform font's `‹ ✕ ⋯ ≡ ✓ ↻ ↗ ⌕` metrics and we
// add no native module (`react-native-svg` is not in Workshop's native set;
// adding it would force an app version bump). Every glyph is laid out in a
// `size` box with the same stroke weight, so icons sit on one optical grid.

export type IconName =
  | "back"
  | "chevron"
  | "chevron-down"
  | "close"
  | "more"
  | "check"
  | "plus"
  | "refresh"
  | "drag"
  | "external"
  | "search"
  | "share"
  | "settings"
  | "bell"
  | "hide"
  | "pin"
  | "trash"
  | "copy";

export type IconTone = "primary" | "secondary" | "muted" | "accent" | "danger" | "onAccent";

const TONE: Record<IconTone, string> = {
  primary: tokens.text.primary,
  secondary: tokens.text.secondary,
  muted: tokens.text.muted,
  accent: tokens.accent.default,
  danger: tokens.status.danger,
  onAccent: tokens.text.onAccent,
};

export interface IconProps {
  name: IconName;
  /** Box size in pt. Default 20. */
  size?: number;
  /** Token tone. Ignored when `color` is set. Default `primary`. */
  tone?: IconTone;
  /** Explicit color (e.g. a list hue). Prefer `tone`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The one stroke weight, scaled with the box (1.5 at 16, 1.8 at 20). */
function iconStroke(size: number): number {
  return Math.max(1.5, Math.round(size * 0.09 * 10) / 10);
}

export function Icon({ name, size = 20, tone = "primary", color, style, testID }: IconProps) {
  const c = color ?? TONE[tone];
  const s = iconStroke(size);
  return (
    <View
      testID={testID}
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      pointerEvents="none"
    >
      {GLYPHS[name](size, s, c)}
    </View>
  );
}

type Glyph = (size: number, stroke: number, color: string) => ReactNode;

const abs = { position: "absolute" as const };

function bar(length: number, stroke: number, color: string, extra?: ViewStyle): ReactNode {
  return (
    <View
      style={[
        abs,
        { width: length, height: stroke, borderRadius: stroke / 2, backgroundColor: color },
        extra,
      ]}
    />
  );
}

function chevron(size: number, stroke: number, color: string, rotate: string, nudge: ViewStyle) {
  const side = size * 0.46;
  return (
    <View
      style={[
        {
          width: side,
          height: side,
          borderTopWidth: stroke,
          borderLeftWidth: stroke,
          borderColor: color,
          borderTopLeftRadius: stroke / 2,
          transform: [{ rotate }],
        },
        nudge,
      ]}
    />
  );
}

const GLYPHS: Record<IconName, Glyph> = {
  back: (size, s, c) => chevron(size, s, c, "-45deg", { marginLeft: size * 0.16 }),
  chevron: (size, s, c) => chevron(size, s, c, "135deg", { marginRight: size * 0.16 }),
  "chevron-down": (size, s, c) => chevron(size, s, c, "225deg", { marginTop: -size * 0.16 }),
  close: (size, s, c) => (
    <>
      {bar(size * 0.78, s, c, { transform: [{ rotate: "45deg" }] })}
      {bar(size * 0.78, s, c, { transform: [{ rotate: "-45deg" }] })}
    </>
  ),
  plus: (size, s, c) => (
    <>
      {bar(size * 0.72, s, c)}
      {bar(size * 0.72, s, c, { transform: [{ rotate: "90deg" }] })}
    </>
  ),
  more: (size, _s, c) => {
    const d = Math.max(3, size * 0.16);
    return (
      <View style={{ flexDirection: "row", gap: d * 0.8 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: c }} />
        ))}
      </View>
    );
  },
  check: (size, s, c) => (
    <View
      style={{
        width: size * 0.3,
        height: size * 0.6,
        borderRightWidth: s,
        borderBottomWidth: s,
        borderColor: c,
        borderBottomRightRadius: s / 2,
        marginTop: -size * 0.12,
        transform: [{ rotate: "45deg" }],
      }}
    />
  ),
  drag: (size, s, c) => (
    <View style={{ gap: size * 0.17, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{ width: size * 0.64, height: s, borderRadius: s / 2, backgroundColor: c }}
        />
      ))}
    </View>
  ),
  refresh: (size, s, c) => {
    const d = size * 0.7;
    const head = size * 0.22;
    return (
      <>
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            borderWidth: s,
            borderColor: c,
            borderTopColor: "transparent",
            transform: [{ rotate: "45deg" }],
          }}
        />
        {/* Arrowhead at the open end of the arc (top-right). */}
        <View
          style={[
            abs,
            {
              top: size * 0.1,
              right: size * 0.12,
              width: head,
              height: head,
              borderTopWidth: s,
              borderRightWidth: s,
              borderColor: c,
              transform: [{ rotate: "15deg" }],
            },
          ]}
        />
      </>
    );
  },
  external: (size, s, c) => {
    const box = size * 0.62;
    const head = size * 0.34;
    return (
      <>
        {/* Open box (left + bottom), the page the link leaves. */}
        <View
          style={[
            abs,
            {
              left: size * 0.14,
              bottom: size * 0.14,
              width: box,
              height: box,
              borderLeftWidth: s,
              borderBottomWidth: s,
              borderColor: c,
              borderBottomLeftRadius: s,
            },
          ]}
        />
        {/* Arrow out to the top-right. */}
        <View
          style={[
            abs,
            {
              top: size * 0.14,
              right: size * 0.14,
              width: head,
              height: head,
              borderTopWidth: s,
              borderRightWidth: s,
              borderColor: c,
            },
          ]}
        />
        {bar(size * 0.52, s, c, {
          top: size * 0.36,
          left: size * 0.32,
          transform: [{ rotate: "-45deg" }],
        })}
      </>
    );
  },
  search: (size, s, c) => {
    const d = size * 0.56;
    return (
      <>
        <View
          style={[
            abs,
            {
              top: size * 0.12,
              left: size * 0.12,
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: s,
              borderColor: c,
            },
          ]}
        />
        {bar(size * 0.3, s, c, {
          bottom: size * 0.2,
          right: size * 0.08,
          transform: [{ rotate: "45deg" }],
        })}
      </>
    );
  },
  share: (size, s, c) => {
    const w = size * 0.6;
    const head = size * 0.26;
    return (
      <>
        <View
          style={[
            abs,
            {
              bottom: size * 0.1,
              width: w,
              height: size * 0.42,
              borderLeftWidth: s,
              borderRightWidth: s,
              borderBottomWidth: s,
              borderColor: c,
              borderBottomLeftRadius: s,
              borderBottomRightRadius: s,
            },
          ]}
        />
        <View
          style={[
            abs,
            {
              top: size * 0.06,
              width: s,
              height: size * 0.56,
              backgroundColor: c,
              borderRadius: s,
            },
          ]}
        />
        <View
          style={[
            abs,
            {
              top: size * 0.1,
              width: head,
              height: head,
              borderTopWidth: s,
              borderLeftWidth: s,
              borderColor: c,
              transform: [{ rotate: "45deg" }],
            },
          ]}
        />
      </>
    );
  },
  // A gear (UX pass 3.4 asked for one; sliders read as "filter"): an outlined
  // ring with eight short teeth and a hub, on the same stroke as every icon.
  // No fills, so it reads on any surface.
  settings: (size, s, c) => {
    const ring = size * 0.6;
    const hub = size * 0.22;
    const tooth = { w: size * 0.13, h: size * 0.12 };
    const radius = ring / 2 + tooth.h / 2 - s / 2;
    return (
      <>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <View
            key={deg}
            style={[
              abs,
              {
                width: tooth.w,
                height: tooth.h,
                borderRadius: s / 2,
                backgroundColor: c,
                transform: [{ rotate: `${deg}deg` }, { translateY: -radius }],
              },
            ]}
          />
        ))}
        <View
          style={[
            abs,
            { width: ring, height: ring, borderRadius: ring / 2, borderWidth: s, borderColor: c },
          ]}
        />
        <View
          style={[
            abs,
            { width: hub, height: hub, borderRadius: hub / 2, borderWidth: s, borderColor: c },
          ]}
        />
      </>
    );
  },
  // An eye with a slash through it: "Hide" (a per-viewer hide, not delete).
  hide: (size, s, c) => (
    <>
      <View
        style={{
          width: size * 0.84,
          height: size * 0.5,
          borderRadius: size * 0.42,
          borderWidth: s,
          borderColor: c,
        }}
      />
      <View
        style={[
          abs,
          { width: size * 0.2, height: size * 0.2, borderRadius: size * 0.1, backgroundColor: c },
        ]}
      />
      {bar(size * 0.96, s, c, { transform: [{ rotate: "-40deg" }] })}
    </>
  ),
  bell: (size, s, c) => {
    const w = size * 0.56;
    return (
      <>
        <View
          style={[
            abs,
            {
              top: size * 0.14,
              width: w,
              height: size * 0.56,
              borderTopLeftRadius: w / 2,
              borderTopRightRadius: w / 2,
              borderTopWidth: s,
              borderLeftWidth: s,
              borderRightWidth: s,
              borderColor: c,
            },
          ]}
        />
        {bar(size * 0.78, s, c, { top: size * 0.68 })}
        <View
          style={[
            abs,
            {
              top: size * 0.78,
              width: size * 0.2,
              height: size * 0.1,
              borderBottomLeftRadius: size * 0.1,
              borderBottomRightRadius: size * 0.1,
              backgroundColor: c,
            },
          ]}
        />
      </>
    );
  },
  pin: (size, s, c) => {
    const head = size * 0.36;
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          transform: [{ rotate: "35deg" }],
        }}
      >
        <View
          style={{
            marginTop: size * 0.08,
            width: head,
            height: head,
            borderRadius: head / 2,
            backgroundColor: c,
          }}
        />
        <View style={{ width: s, height: size * 0.46, backgroundColor: c, borderRadius: s }} />
      </View>
    );
  },
  trash: (size, s, c) => (
    <>
      {bar(size * 0.74, s, c, { top: size * 0.22 })}
      <View
        style={[
          abs,
          {
            top: size * 0.1,
            width: size * 0.26,
            height: size * 0.13,
            borderTopWidth: s,
            borderLeftWidth: s,
            borderRightWidth: s,
            borderColor: c,
            borderTopLeftRadius: s,
            borderTopRightRadius: s,
          },
        ]}
      />
      <View
        style={[
          abs,
          {
            top: size * 0.3,
            width: size * 0.54,
            height: size * 0.6,
            borderLeftWidth: s,
            borderRightWidth: s,
            borderBottomWidth: s,
            borderColor: c,
            borderBottomLeftRadius: size * 0.08,
            borderBottomRightRadius: size * 0.08,
          },
        ]}
      />
    </>
  ),
  copy: (size, s, c) => {
    const sq = size * 0.56;
    const r = Math.max(1.5, size * 0.12);
    return (
      <>
        <View
          style={[
            abs,
            {
              top: size * 0.12,
              right: size * 0.12,
              width: sq,
              height: sq,
              borderTopWidth: s,
              borderRightWidth: s,
              borderTopRightRadius: r,
              borderColor: c,
            },
          ]}
        />
        <View
          style={[
            abs,
            {
              bottom: size * 0.12,
              left: size * 0.12,
              width: sq,
              height: sq,
              borderWidth: s,
              borderRadius: r,
              borderColor: c,
            },
          ]}
        />
      </>
    );
  },
};
