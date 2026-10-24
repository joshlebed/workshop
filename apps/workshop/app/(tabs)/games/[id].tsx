import { Redirect } from "expo-router";
import GameBoard from "../../../src/legacyGames/screens/GameBoard";
import { useLegacyGamesPhase } from "../../../src/lib/useLegacyGamesPhase";

export default function WorkshopGameBoard() {
  const phase = useLegacyGamesPhase();
  // Post-sunset the Games home is the hand-off screen; send boards there
  // (and home once the tab itself is gone).
  if (phase === "gone") return <Redirect href="/" />;
  if (phase === "moved") return <Redirect href="/games" />;
  return <GameBoard />;
}
