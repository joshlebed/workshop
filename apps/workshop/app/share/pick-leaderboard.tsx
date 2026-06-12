import { Redirect, useLocalSearchParams } from "expo-router";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";

export default function PickLeaderboardRedirect() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const target = GAMES_TAB_ENABLED ? "/share/pick-game" : "/share";
  const query = encodeShareQuery(params);
  return (
    <Redirect href={(query ? `${target}${query}` : target) as "/share/pick-game" | "/share"} />
  );
}

function encodeShareQuery(params: { url?: string | string[]; text?: string | string[] }): string {
  const qs = new URLSearchParams();
  const url = firstParam(params.url);
  const text = firstParam(params.text);
  if (url) qs.set("url", url);
  if (text) qs.set("text", text);
  const encoded = qs.toString();
  return encoded ? `?${encoded}` : "";
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
