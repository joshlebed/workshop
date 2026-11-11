import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { openHighScore } from "../../../src/lib/highscoreHandoff";
import { GamesMovedScreen } from "../../../src/screens/gamesMoved/GamesMovedScreen";

const FRIENDS_MOVED_COPY = {
  glyph: "👋",
  title: "Friends live in HighScore",
  body: "Open the invite there to accept it. Same account.",
};

// Friend invite (`/friends/accept/:token`). Workshop has no friends surface
// since the 2026-11 usability pass (lists are shared per list, by link), but
// invite links minted earlier still point at this domain and the Workshop AASA
// claims `/friends/accept/*`, so an installed Workshop app can intercept them.
// Forward to HighScore's accept screen, modelled on the `/g/:token` hand-off,
// and show the hand-off behind it so the link never dead-ends. Mounts
// signed-out too (AuthGate's `onFriendAccept`).
export default function WorkshopFriendAcceptHandoff() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const path = token ? `/friends/accept/${encodeURIComponent(token)}` : undefined;

  useEffect(() => {
    void openHighScore(path ? { path } : {});
  }, [path]);

  return (
    <GamesMovedScreen
      target={path ? { path } : {}}
      copy={FRIENDS_MOVED_COPY}
      onCancel={() => router.replace("/")}
    />
  );
}
