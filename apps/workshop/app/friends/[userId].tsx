import { Redirect } from "expo-router";
import FriendProfile from "../../src/friends/FriendProfile";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function WorkshopFriendProfile() {
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <FriendProfile />;
}
