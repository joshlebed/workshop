import { useEffect, useState } from "react";
import {
  type LegacyGamesPhase,
  legacyGamesPhase,
  nextLegacyGamesPhaseChange,
} from "./featureFlags";

// setTimeout clamps delays above 2^31-1 ms to ~1ms, which would flip the
// surface immediately. Re-arm in chunks instead.
const MAX_TIMEOUT_MS = 2_147_000_000;

/**
 * Render-time view of `legacyGamesPhase()` that also advances when a phase
 * boundary passes while the app is open, so a user who leaves Workshop
 * foregrounded across the cutover sees the next phase without relaunching.
 */
export function useLegacyGamesPhase(): LegacyGamesPhase {
  const [phase, setPhase] = useState(() => legacyGamesPhase());

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm for the next boundary after each phase change
  useEffect(() => {
    const nextAt = nextLegacyGamesPhaseChange();
    if (nextAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const remaining = nextAt - Date.now();
      if (remaining <= 0) {
        setPhase(legacyGamesPhase());
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase]);

  return phase;
}
