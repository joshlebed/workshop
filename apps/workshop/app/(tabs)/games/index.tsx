import { Redirect } from "expo-router";
import { WorkshopGamesHome } from "../../../src/legacyGames/WorkshopGamesHome";
import { useLegacyGamesPhase } from "../../../src/lib/useLegacyGamesPhase";
import { GamesMovedScreen } from "../../../src/screens/gamesMoved/GamesMovedScreen";
import { GamesSunsetBanner } from "../../../src/screens/gamesMoved/GamesSunsetBanner";

// Games home (G1b) through the HighScore cutover: active → the frozen legacy
// Games UI under a countdown banner; moved → the persistent "moved to
// HighScore" hand-off, still reachable from the Lists / Games switch; gone
// (and flag off) → the route redirects home, exactly like the pre-tabs app.
export default function GamesHomeRoute() {
  const phase = useLegacyGamesPhase();
  if (phase === "gone") return <Redirect href="/" />;
  if (phase === "moved") return <GamesMovedScreen showTabSwitch />;
  return <WorkshopGamesHome banner={<GamesSunsetBanner />} />;
}
