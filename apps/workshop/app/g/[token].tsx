import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import GameShareLanding from "../../src/legacyGames/screens/GameShareLanding";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { openHighScore } from "../../src/lib/highscoreHandoff";
import { useLegacyGamesPhase } from "../../src/lib/useLegacyGamesPhase";
import { GamesMovedScreen } from "../../src/screens/gamesMoved/GamesMovedScreen";

// Play link (`/g/:token`). The backend has minted these on highscore.live
// since FIX-1, but old iMessage links still point at this domain — and the
// Workshop AASA claims `/g/*`, so an installed Workshop app intercepts them
// before the Pages-level 301 can. Post-sunset (incl. "gone" — links must never
// dead-end): forward to HighScore's resolver and show the hand-off behind it.
export default function WorkshopGameShareLanding() {
  const phase = useLegacyGamesPhase();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const path = token ? `/g/${encodeURIComponent(token)}` : undefined;
  const handoff = GAMES_TAB_ENABLED && phase !== "active";

  useEffect(() => {
    if (!handoff) return;
    void openHighScore(path ? { path } : {});
  }, [handoff, path]);

  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  if (handoff) {
    return <GamesMovedScreen target={path ? { path } : {}} onCancel={() => router.replace("/")} />;
  }
  return <GameShareLanding />;
}
