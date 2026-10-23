import { WORKSHOP_GAMES_SUNSET_AT } from "@workshop/shared/constants";

// Bundle-time feature flags, resolved from EXPO_PUBLIC_* env vars.
//
// EXPO_PUBLIC_ENABLE_GAMES gates the Games tab (epic #279). Launched to
// production 2026-06-10: unset now means ON everywhere. Set "0" to disable
// (kill switch — e.g. in the Cloudflare Pages build env or eas.json) or "1"
// to force on; `scripts/e2e.sh` still exports "1" explicitly.
const rawEnableGames = process.env.EXPO_PUBLIC_ENABLE_GAMES;
export const GAMES_TAB_ENABLED = rawEnableGames !== "0";

// HighScore cutover gate. Workshop's frozen Games UI (`src/legacyGames`) runs
// until `WORKSHOP_GAMES_SUNSET_AT` (shared with the backend), then every games
// route renders the "moved to HighScore" hand-off instead. Date-driven so the
// pre-sunset banner and the hard cutover ship in ONE OTA — no second deploy on
// the day. Override for local/e2e work with EXPO_PUBLIC_LEGACY_GAMES_SUNSET_AT:
// an ISO instant, "never" (games stay on), or "now" (force the cutover).
const rawSunset = process.env.EXPO_PUBLIC_LEGACY_GAMES_SUNSET_AT;

export function resolveLegacyGamesSunsetAt(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return Date.parse(WORKSHOP_GAMES_SUNSET_AT);
  if (value === "never") return null;
  if (value === "now") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.parse(WORKSHOP_GAMES_SUNSET_AT) : parsed;
}

/** Epoch ms at which Workshop's games surfaces switch to the hand-off; null = never. */
export const LEGACY_GAMES_SUNSET_AT = resolveLegacyGamesSunsetAt(rawSunset);

/** True while Workshop still renders its own Games UI (flag on and before the sunset). */
export function isLegacyGamesActive(now: number = Date.now()): boolean {
  if (!GAMES_TAB_ENABLED) return false;
  return LEGACY_GAMES_SUNSET_AT === null || now < LEGACY_GAMES_SUNSET_AT;
}
