import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import PickGame from "../../src/legacyGames/screens/PickGame";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { useLegacyGamesActive } from "../../src/lib/useLegacyGamesActive";
import { GamesMovedScreen } from "../../src/screens/gamesMoved/GamesMovedScreen";

export default function WorkshopPickGame() {
  const legacyActive = useLegacyGamesActive();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  if (!legacyActive) {
    // Post-sunset: hand the shared payload to HighScore's picker instead.
    return (
      <GamesMovedScreen
        target={{ share: { url: firstParam(params.url), text: firstParam(params.text) } }}
        onCancel={() => router.replace("/")}
      />
    );
  }
  return <PickGame />;
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ? raw : null;
}
