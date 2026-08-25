import { GamesHome } from "@workshop/games/screens/GamesHome";
import { ProfileMenu } from "../../src/components/ProfileMenu";
import { Wordmark } from "../../src/components/Wordmark";

export default function HighScoreGamesHome() {
  return <GamesHome headerLeft={<Wordmark />} headerTrailing={<ProfileMenu />} />;
}
