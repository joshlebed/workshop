import { HomeAccountButtons } from "../../src/components/HomeAccountButtons";
import { Wordmark } from "../../src/components/Wordmark";
import { GamesHome } from "../../src/games/screens/GamesHome";

export default function HomeScreen() {
  return <GamesHome headerLeft={<Wordmark />} headerTrailing={<HomeAccountButtons />} />;
}
