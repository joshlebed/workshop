import { Redirect } from "expo-router";
import GameShareLanding from "../../src/legacyGames/screens/GameShareLanding";
import { LEGACY_GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function WorkshopGameShareLanding() {
  if (!LEGACY_GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <GameShareLanding />;
}
