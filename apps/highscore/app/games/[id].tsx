// Deep link into a cartridge. There is no separate game screen — the deck
// *is* the board — so this hands the id to the shell and steps aside.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useDeckNav } from "../../src/deck/DeckNav";

export default function GameDeepLink() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    if (id) nav.openGame(id);
    router.replace("/");
  }, [id, nav, router]);
  return null;
}
