import { Redirect } from "expo-router";
import GameBoard from "../../../src/legacyGames/screens/GameBoard";
import { useLegacyGamesActive } from "../../../src/lib/useLegacyGamesActive";

export default function WorkshopGameBoard() {
  const legacyActive = useLegacyGamesActive();
  // Post-sunset the Games home is the hand-off screen; send boards there.
  if (!legacyActive) return <Redirect href="/games" />;
  return <GameBoard />;
}
