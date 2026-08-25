// Bundle-time feature flags, resolved from EXPO_PUBLIC_* env vars.
//
// EXPO_PUBLIC_ENABLE_GAMES gates the Games tab (epic #279). Launched to
// production 2026-06-10: unset now means ON everywhere. Set "0" to disable
// (kill switch — e.g. in the Cloudflare Pages build env or eas.json) or "1"
// to force on; `scripts/e2e.sh` still exports "1" explicitly.
const rawEnableGames = process.env.EXPO_PUBLIC_ENABLE_GAMES;
export const GAMES_TAB_ENABLED = rawEnableGames !== "0";

// Transitional HighScore migration gate. Workshop keeps its complete Games
// UI until Wave 4, when this off-state is replaced with the persistent
// "get HighScore" surface. Unset is intentionally ON for zero rollout change.
const rawEnableLegacyGamesTab = process.env.EXPO_PUBLIC_ENABLE_LEGACY_GAMES_TAB;
export const LEGACY_GAMES_TAB_ENABLED = GAMES_TAB_ENABLED && rawEnableLegacyGamesTab !== "0";
