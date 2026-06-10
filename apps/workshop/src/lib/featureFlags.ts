// Bundle-time feature flags, resolved from EXPO_PUBLIC_* env vars.
//
// EXPO_PUBLIC_ENABLE_GAMES gates the Games tab (epic #279). When unset, the
// flag follows the bundle's dev-ness: on for `expo start` dev bundles (local
// dev + e2e), off for production exports/OTA. Set "1" or "0" to force it
// either way — `scripts/e2e.sh` exports "1" explicitly so CI doesn't depend
// on the __DEV__ fallback.
const rawEnableGames = process.env.EXPO_PUBLIC_ENABLE_GAMES;
export const GAMES_TAB_ENABLED = rawEnableGames === undefined ? __DEV__ : rawEnableGames === "1";
