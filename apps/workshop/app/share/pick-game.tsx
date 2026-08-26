import { Redirect } from "expo-router";
import PickGame from "../../src/legacyGames/screens/PickGame";
import { LEGACY_GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function WorkshopPickGame() {
  if (!LEGACY_GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <PickGame />;
}
