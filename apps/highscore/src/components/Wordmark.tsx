import { Platform, Text as RNText, StyleSheet, type TextStyle, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { palette, pixelType, tokens } from "../theme";

interface WordmarkProps {
  /** `lg` is the sign-in hero; `md` is everything else. */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" in Press Start 2P carrying the one sanctioned wordmark glow — a
 * text shadow, so the halo hugs the glyphs instead of boxing them. Type only:
 * the cabinet mark below is the app icon, and at 22pt beside a 13pt wordmark
 * its pixels fall under a physical pixel each and turn to mush. It gets shown
 * where it has room (sign-in), not stapled to every header.
 */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <RNText numberOfLines={1} style={large ? styles.wordLg : styles.wordMd}>
        HighScore
      </RNText>
    </View>
  );
}

const CABINET_UNITS_X = 12;
const CABINET_UNITS_Y = 14;

/** [x, y, w, h, fill] on a 12×14 pixel grid — an upright cabinet. */
const CABINET: [number, number, number, number, string][] = [
  // Hood and body.
  [2, 0, 8, 1, palette.surface3],
  [1, 1, 10, 11, palette.surface2],
  [1, 1, 1, 11, palette.surface3],
  [10, 1, 1, 11, palette.surface3],
  // Lit marquee.
  [2, 1, 8, 1, palette.accent],
  // Screen, and what's on it.
  [2, 3, 8, 5, palette.bg],
  [3, 4, 3, 1, palette.primary],
  [7, 4, 2, 1, palette.primary],
  [3, 5, 1, 1, palette.accent],
  [5, 5, 3, 1, palette.success],
  [4, 6, 2, 1, palette.primary],
  [8, 6, 1, 1, palette.success],
  // Control deck: joystick and two buttons.
  [2, 9, 8, 2, palette.surface3],
  [3, 9, 1, 1, palette.textPrimary],
  [6, 9, 1, 1, palette.primary],
  [8, 9, 1, 1, palette.accent],
  // Legs.
  [2, 12, 2, 2, palette.surface3],
  [8, 12, 2, 2, palette.surface3],
];

/**
 * The app icon, drawn as rects: purple cabinet on the dark ground, marquee in
 * yellow, screen lit pink with chartreuse pixels. Keep it at 48pt or larger —
 * each grid unit needs at least 4 physical pixels to read as pixel art.
 */
export function CabinetMark({ size = 72 }: { size?: number }) {
  return (
    <Svg
      width={(size * CABINET_UNITS_X) / CABINET_UNITS_Y}
      height={size}
      viewBox={`0 0 ${CABINET_UNITS_X} ${CABINET_UNITS_Y}`}
    >
      {CABINET.map(([x, y, w, h, fill]) => (
        <Rect key={`${x}-${y}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </Svg>
  );
}

// The one sanctioned wordmark glow. RN 0.83 deprecates the split
// `textShadow*` props on web in favour of the CSS shorthand; native still
// wants the split form.
const wordBase: TextStyle = {
  color: tokens.text.primary,
  ...(Platform.OS === "web"
    ? ({ textShadow: `0 0 10px ${tokens.neon.pinkGlow}` } as TextStyle)
    : {
        textShadowColor: tokens.neon.pinkGlow,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
      }),
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  wordMd: { ...pixelType(13), ...wordBase },
  wordLg: { ...pixelType(20), ...wordBase },
});
