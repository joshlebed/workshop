// Deep link to one player inside the PLAYERS panel.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useDeckNav } from "../../src/deck/DeckNav";

export default function FriendProfileDeepLink() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const via = Array.isArray(params.via) ? params.via[0] : params.via;
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    if (userId) nav.openPlayer(userId, via ?? null);
    router.replace("/");
  }, [userId, via, nav, router]);
  return null;
}
