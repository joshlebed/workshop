import { WORKSHOP_GAMES_REMOVED_AT, WORKSHOP_GAMES_SUNSET_AT } from "@workshop/shared/constants";

// Bundle-time feature flags, resolved from EXPO_PUBLIC_* env vars.
//
// EXPO_PUBLIC_ENABLE_GAMES gates the Games tab (epic #279). Launched to
// production 2026-06-10: unset now means ON everywhere. Set "0" to disable
// (kill switch — e.g. in the Cloudflare Pages build env or eas.json) or "1"
// to force on; `scripts/e2e.sh` still exports "1" explicitly.
const rawEnableGames = process.env.EXPO_PUBLIC_ENABLE_GAMES;
export const GAMES_TAB_ENABLED = rawEnableGames !== "0";

// HighScore cutover phases (dates shared with the backend):
//   active → Workshop's frozen Games UI (`src/legacyGames`) runs, with a
//            countdown banner.
//   moved  → from WORKSHOP_GAMES_SUNSET_AT: every games route is the
//            "moved to HighScore" hand-off; the tab + switch stay so users
//            can find out where their games went.
//   gone   → from WORKSHOP_GAMES_REMOVED_AT: the Games tab and switch are
//            removed entirely (same shell as the pre-tabs app). Link and
//            share hand-offs still work so nothing dead-ends.
// Date-driven so all three ship in ONE OTA. Override for local/e2e work with
// EXPO_PUBLIC_LEGACY_GAMES_PHASE=active|moved|gone.
export type LegacyGamesPhase = "active" | "moved" | "gone";

export const LEGACY_GAMES_PHASE_BOUNDARIES: ReadonlyArray<{ at: number; phase: LegacyGamesPhase }> =
  [
    { at: Date.parse(WORKSHOP_GAMES_SUNSET_AT), phase: "moved" },
    { at: Date.parse(WORKSHOP_GAMES_REMOVED_AT), phase: "gone" },
  ];

export function parseLegacyGamesPhaseOverride(raw: string | undefined): LegacyGamesPhase | null {
  const value = raw?.trim();
  return value === "active" || value === "moved" || value === "gone" ? value : null;
}

const forcedPhase = parseLegacyGamesPhaseOverride(process.env.EXPO_PUBLIC_LEGACY_GAMES_PHASE);

export function legacyGamesPhaseAt(now: number, forced: LegacyGamesPhase | null): LegacyGamesPhase {
  if (!GAMES_TAB_ENABLED) return "gone";
  if (forced) return forced;
  let phase: LegacyGamesPhase = "active";
  for (const boundary of LEGACY_GAMES_PHASE_BOUNDARIES) {
    if (now >= boundary.at) phase = boundary.phase;
  }
  return phase;
}

export function legacyGamesPhase(now: number = Date.now()): LegacyGamesPhase {
  return legacyGamesPhaseAt(now, forcedPhase);
}

/** Epoch ms of the next phase change after `now`, or null when none remain (or forced). */
export function nextLegacyGamesPhaseChange(now: number = Date.now()): number | null {
  if (forcedPhase || !GAMES_TAB_ENABLED) return null;
  const next = LEGACY_GAMES_PHASE_BOUNDARIES.find((b) => b.at > now);
  return next ? next.at : null;
}

/** True while Workshop still renders its own Games UI. */
export function isLegacyGamesActive(now: number = Date.now()): boolean {
  return legacyGamesPhase(now) === "active";
}
