import FriendProfile from "@workshop/games/screens/FriendProfile";
import { Redirect } from "expo-router";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function WorkshopFriendProfile() {
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <FriendProfile />;
}
