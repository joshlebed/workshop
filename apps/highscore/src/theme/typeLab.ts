// Type lab — a review-only switcher for the secondary (non-pixel) face and
// for score numerals. Lets the owner compare candidate fonts live in the
// preview. Never ships: delete this file (and TypeLabChip) once a face is
// picked and the choice is written into tokens.ts / DESIGN.md.
import { useSyncExternalStore } from "react";
import { Platform, type TextStyle } from "react-native";
import { PIXEL_FONT } from "./tokens";

export type LabFont = "system" | "grotesk" | "inter" | "plex";
export type LabScores = "pixel" | "tabular";
export type LabButtons = "secondary" | "pixel";
export interface TypeLab {
  font: LabFont;
  scores: LabScores;
  buttons: LabButtons;
}

export const LAB_FONT_LABEL: Record<LabFont, string> = {
  system: "System",
  grotesk: "Space Grotesk",
  inter: "Inter",
  plex: "IBM Plex Sans",
};

type Weight = "regular" | "medium" | "semibold" | "bold";
const FAMILY: Record<Exclude<LabFont, "system">, Record<Weight, string>> = {
  grotesk: {
    regular: "SpaceGrotesk_400Regular",
    medium: "SpaceGrotesk_500Medium",
    semibold: "SpaceGrotesk_600SemiBold",
    bold: "SpaceGrotesk_700Bold",
  },
  inter: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  plex: {
    regular: "IBMPlexSans_400Regular",
    medium: "IBMPlexSans_500Medium",
    semibold: "IBMPlexSans_600SemiBold",
    bold: "IBMPlexSans_700Bold",
  },
};
const WEIGHT: Record<Weight, TextStyle["fontWeight"]> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

const DEFAULT: TypeLab = { font: "grotesk", scores: "pixel", buttons: "secondary" };
const KEY = "highscore.typeLab";

function readInitial(): TypeLab {
  if (Platform.OS !== "web" || typeof window === "undefined") return DEFAULT;
  let lab = DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) lab = { ...lab, ...(JSON.parse(raw) as Partial<TypeLab>) };
  } catch {}
  const q = new URLSearchParams(window.location.search);
  const font = q.get("font");
  const scores = q.get("scores");
  const buttons = q.get("buttons");
  if (font && font in LAB_FONT_LABEL) lab = { ...lab, font: font as LabFont };
  if (scores === "pixel" || scores === "tabular") lab = { ...lab, scores };
  if (buttons === "pixel" || buttons === "secondary") lab = { ...lab, buttons };
  return lab;
}

let state: TypeLab = readInitial();
const listeners = new Set<() => void>();

export function setTypeLab(patch: Partial<TypeLab>) {
  state = { ...state, ...patch };
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }
  for (const l of listeners) l();
}

export function useTypeLab(): TypeLab {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Secondary-face body text at a given weight (names, copy, captions). */
export function bodyType(lab: TypeLab, weight: Weight = "regular"): TextStyle {
  if (lab.font === "system") return { fontWeight: WEIGHT[weight] };
  // Each weight is its own registered family; keep fontWeight normal so the
  // browser doesn't synthesise a faux bold on top.
  return { fontFamily: FAMILY[lab.font][weight], fontWeight: "400" };
}

/**
 * Small uppercase UI label (turnout, "YOU", TODAY chip, FIX/EDIT) in the
 * secondary face. `px` is the pixel-face size it replaces; the secondary
 * face needs ~1.35× to match optical size.
 */
export function uiType(lab: TypeLab, px: number): TextStyle {
  const fontSize = Math.round(px * 1.35);
  return {
    ...bodyType(lab, "bold"),
    fontSize,
    lineHeight: Math.round(fontSize * 1.3),
    letterSpacing: 0.6,
    textTransform: "uppercase",
  };
}

/** Score numerals: pixel face, or the secondary face with tabular figures. */
export function scoreType(lab: TypeLab, px: number): TextStyle {
  if (lab.scores === "pixel") {
    return { fontFamily: PIXEL_FONT, fontSize: px, lineHeight: Math.round(px * 1.5) };
  }
  const fontSize = Math.round(px * 1.45);
  return {
    ...bodyType(lab, "bold"),
    fontSize,
    lineHeight: Math.round(fontSize * 1.25),
    fontVariant: ["tabular-nums"],
  };
}

/** Button labels: secondary face semibold, or the pixel face. */
export function buttonType(lab: TypeLab, px = 10): TextStyle {
  if (lab.buttons === "pixel") {
    return {
      fontFamily: PIXEL_FONT,
      fontSize: px,
      lineHeight: Math.round(px * 1.6),
      letterSpacing: 1,
      textTransform: "uppercase",
    };
  }
  return { ...bodyType(lab, "semibold"), fontSize: 16 };
}
