import GameBoard from "@workshop/games/screens/GameBoard";
import { Redirect } from "expo-router";
import { LEGACY_GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";

export default function WorkshopGameBoard() {
  if (!LEGACY_GAMES_TAB_ENABLED) return <Redirect href="/" />;
  return <GameBoard />;
}
