import { Redirect } from "expo-router";
import { WorkshopGamesHome } from "../../../src/legacyGames/WorkshopGamesHome";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";
import { useLegacyGamesActive } from "../../../src/lib/useLegacyGamesActive";
import { GamesMovedScreen } from "../../../src/screens/gamesMoved/GamesMovedScreen";
import { GamesSunsetBanner } from "../../../src/screens/gamesMoved/GamesSunsetBanner";

// Games home (G1b). Before the HighScore sunset: the frozen legacy Games UI
// under a countdown banner. After: the persistent "moved to HighScore"
// hand-off, still reachable from the Lists / Games switch. Flag off must look
// exactly like the pre-tabs app, so the route redirects home.
export default function GamesHomeRoute() {
  const legacyActive = useLegacyGamesActive();
  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }
  if (!legacyActive) {
    return <GamesMovedScreen showTabSwitch />;
  }
  return <WorkshopGamesHome banner={<GamesSunsetBanner />} />;
}
