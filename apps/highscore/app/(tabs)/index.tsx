import { ProfileMenu } from "../../src/components/ProfileMenu";
import { Wordmark } from "../../src/components/Wordmark";
import { GamesHome } from "../../src/games/screens/GamesHome";

export default function HighScoreGamesHome() {
  return <GamesHome headerLeft={<Wordmark />} headerTrailing={<ProfileMenu />} />;
}
