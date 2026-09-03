// Deep link to the PLAYERS panel. Friends are a panel on the one screen, not
// a route of their own.
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { useDeckNav } from "../../src/deck/DeckNav";

export default function FriendsDeepLink() {
  const nav = useDeckNav();
  const router = useRouter();
  useEffect(() => {
    nav.setPanel("players");
    router.replace("/");
  }, [nav, router]);
  return null;
}
