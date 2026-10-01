// The five competing HighScore UX explorations, as data.
//
// This file is the playground's only source of truth for "which variants
// exist". Everything else — the toggle sheet, the keyboard shortcuts, the route
// dispatchers, the docs table — reads it. Each variant's full rationale lives
// in `src/variants/<key>/UX-EXPLORATION.md`, copied verbatim from its branch.

export const UX_VARIANTS = ["ux1", "ux2", "ux3", "ux4", "ux5"] as const;

export type UxVariant = (typeof UX_VARIANTS)[number];

export const DEFAULT_UX_VARIANT: UxVariant = "ux1";

/** Storage key for the operator's current pick. Cleared by "Reset app state". */
export const UX_VARIANT_STORAGE_KEY = "highscore.uxVariant";

export interface UxVariantMeta {
  key: UxVariant;
  /** Display name, from the variant's own UX-EXPLORATION.md title. */
  name: string;
  /** One line, distilled from that doc's "the concept" section. */
  blurb: string;
  /** Branch the variant was copied from. */
  branch: string;
  /** Its original draft PR. */
  pr: number;
}

export const UX_VARIANT_META: Record<UxVariant, UxVariantMeta> = {
  ux1: {
    key: "ux1",
    name: "Cartridge Deck",
    blurb:
      "One screen, one deck. Swipe full-bleed game cartridges, scroll a cartridge down for its history, zoom out to the shelf. Nothing pushes a route.",
    branch: "joshlebed/hs-ux1-cartridge-deck",
    pr: 414,
  },
  ux2: {
    key: "ux2",
    name: "Expand In Place",
    blurb:
      "Zero route pushes in the main loop. A ledger row expands into its board while the others squeeze into spines; friends slide over from the right edge.",
    branch: "joshlebed/hs-ux2-expand-in-place",
    pr: 410,
  },
  ux3: {
    key: "ux3",
    name: "Timeline + Sheet Stack",
    blurb:
      "Time is the primary axis: one feed of days, and every other surface is a sheet that keeps that feed visible behind it.",
    branch: "joshlebed/hs-ux3-timeline-sheets",
    pr: 411,
  },
  ux4: {
    key: "ux4",
    name: "Players × Games",
    blurb:
      "The same day has two projections. GAMES (a game per row) flips in place to PLAYERS (the transpose), under a fixed three-key panel.",
    branch: "joshlebed/hs-ux4-players-matrix",
    pr: 413,
  },
  ux5: {
    key: "ux5",
    name: "Gesture Dock",
    blurb:
      "Everything inside one thumb: full-bleed game bands you swipe, and a persistent bottom dock whose keys morph per screen.",
    branch: "joshlebed/hs-ux5-gesture-dock",
    pr: 412,
  },
};

export function isUxVariant(value: unknown): value is UxVariant {
  return typeof value === "string" && (UX_VARIANTS as readonly string[]).includes(value);
}
