import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import PickGame from "../../src/legacyGames/screens/PickGame";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { useLegacyGamesPhase } from "../../src/lib/useLegacyGamesPhase";
import { GamesMovedScreen } from "../../src/screens/gamesMoved/GamesMovedScreen";

export default function WorkshopPickGame() {
  const phase = useLegacyGamesPhase();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  if (!GAMES_TAB_ENABLED) return <Redirect href="/" />;
  if (phase !== "active") {
    // Post-sunset: hand the shared payload to HighScore's picker instead. Kept
    // through "gone" too — the share extension still delivers scores here
    // until PR-10 removes it, and a dead end would lose the user's result.
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
