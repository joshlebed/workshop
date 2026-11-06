// The type rules from DESIGN.md, hard-coded (UX-DECISIONS.md entry 8):
// Press Start 2P for the wordmark, game names and score numerals; Space
// Grotesk for everything else; buttons in Space Grotesk 600.
import { Platform, type TextStyle } from "react-native";
import { PIXEL_FONT, SECONDARY_FONT } from "./tokens";

export type SecondaryWeight = keyof typeof SECONDARY_FONT;

/** Secondary-face text at a given weight (names, copy, captions). */
export function bodyType(weight: SecondaryWeight = "regular"): TextStyle {
  // Each weight is its own registered family; keep fontWeight normal so the
  // browser doesn't synthesise a faux bold on top.
  return { fontFamily: SECONDARY_FONT[weight], fontWeight: "400" };
}

/**
 * Small uppercase UI label (turnout, "YOU", TODAY chip, FIX/EDIT) in the
 * secondary face. `px` is the pixel-face size it replaces; the secondary
 * face needs ~1.35× to match optical size (pixel 8 → 11, 10 → 13/14, 11 → 15).
 */
export function uiType(px: number): TextStyle {
  const fontSize = Math.round(px * 1.35);
  return {
    ...bodyType("bold"),
    fontSize,
    lineHeight: Math.round(fontSize * 1.3),
    letterSpacing: 0.6,
    textTransform: "uppercase",
  };
}

/** Section label over a list group: small, tracked, uppercase, secondary. One style for every screen. */
export function sectionLabelType(): TextStyle {
  return uiType(9);
}

/** Score numerals: ranks, scores, the podium cell, streak counts, day-strip values. */
export function scoreType(px: number): TextStyle {
  return { fontFamily: PIXEL_FONT, fontSize: px, lineHeight: Math.round(px * 1.5) };
}

/** Button labels: Space Grotesk 600, 16px. Never pixel. */
export function buttonType(): TextStyle {
  return { ...bodyType("semibold"), fontSize: 16 };
}

/**
 * Formatted share text (score bodies, emoji grids): monospace, tight enough
 * that multi-line emoji grids read as one block. iOS clips any glyph taller
 * than the line box, and an Apple Color Emoji glyph is ~1.3× the font size:
 * 1.2× (14px at 12) cut the tops off every emoji on the game board, so 1.4×.
 */
export function shareTextType(px: number): TextStyle {
  return {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: px,
    lineHeight: Math.round(px * 1.4),
  };
}
