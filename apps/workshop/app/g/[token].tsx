import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { openHighScore } from "../../src/lib/highscoreHandoff";
import { GamesMovedScreen } from "../../src/screens/gamesMoved/GamesMovedScreen";

// Play link (`/g/:token`). Games were removed from Workshop on 2026-11-06 and
// the backend has minted these on highscore.live since FIX-1, but old iMessage
// links still point at this domain — and the Workshop AASA claims `/g/*`, so an
// installed Workshop app intercepts them before the Pages-level 301 can.
// Forward to HighScore's resolver and show the hand-off behind it so the link
// never dead-ends. Mounts signed-out too (AuthGate's `onGameShare`).
export default function WorkshopGameShareLanding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const path = token ? `/g/${encodeURIComponent(token)}` : undefined;

  useEffect(() => {
    void openHighScore(path ? { path } : {});
  }, [path]);

  return <GamesMovedScreen target={path ? { path } : {}} onCancel={() => router.replace("/")} />;
}
