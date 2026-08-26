import { Redirect } from "expo-router";
import FriendAccept from "../../../src/friends/FriendAccept";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";

export default function WorkshopFriendAccept() {
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <FriendAccept />;
}
