import { Redirect } from "expo-router";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";
import { GamesHome } from "../../../src/screens/GamesHome";

// Games home (G1b) — My Games as today's-leaderboard cards. Flag off must
// look exactly like the pre-tabs app, so the route redirects home.
export default function GamesHomeRoute() {
  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }
  return <GamesHome />;
}
