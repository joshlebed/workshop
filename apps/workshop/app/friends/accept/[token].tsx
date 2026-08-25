import FriendAccept from "@workshop/games/screens/FriendAccept";
import { Redirect } from "expo-router";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";

export default function WorkshopFriendAccept() {
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <FriendAccept />;
}
