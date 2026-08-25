import FriendsHome from "@workshop/games/screens/FriendsHome";
import { Redirect } from "expo-router";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function WorkshopFriendsHome() {
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <FriendsHome />;
}
