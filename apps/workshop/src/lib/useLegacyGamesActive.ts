import { useEffect, useState } from "react";
import { isLegacyGamesActive, LEGACY_GAMES_SUNSET_AT } from "./featureFlags";

// setTimeout clamps delays above 2^31-1 ms to ~1ms, which would flip the
// surface immediately. Re-arm in chunks instead.
const MAX_TIMEOUT_MS = 2_147_000_000;

/**
 * Render-time view of `isLegacyGamesActive()` that also flips when the sunset
 * instant passes while the app is open, so a user who leaves Workshop
 * foregrounded across the cutover sees the hand-off without relaunching.
 */
export function useLegacyGamesActive(): boolean {
  const [active, setActive] = useState(() => isLegacyGamesActive());

  useEffect(() => {
    const sunsetAt = LEGACY_GAMES_SUNSET_AT;
    if (!active || sunsetAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const remaining = sunsetAt - Date.now();
      if (remaining <= 0) {
        setActive(false);
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active]);

  return active;
}
