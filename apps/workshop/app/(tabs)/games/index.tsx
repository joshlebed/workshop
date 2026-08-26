import { Redirect } from "expo-router";
import { WorkshopGamesHome } from "../../../src/legacyGames/WorkshopGamesHome";
import { LEGACY_GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";

// Games home (G1b) — My Games as today's-leaderboard cards. Flag off must
// look exactly like the pre-tabs app, so the route redirects home.
export default function GamesHomeRoute() {
  if (!LEGACY_GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }
  return <WorkshopGamesHome />;
}
