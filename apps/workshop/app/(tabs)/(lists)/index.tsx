import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { HomeLists } from "../../../src/screens/home/HomeLists";
import { HomePanePlaceholder } from "../../../src/screens/twoPane/HomePanePlaceholder";
import { useTwoPane } from "../../../src/screens/twoPane/TwoPane";

export default function Home() {
  // A cold-opened route gets home injected beneath it as the stack anchor, and
  // the anchor inherits the deep link's params (`/?id=<listId>` after backing
  // out). Home takes no params; drop them so the URL reads `/`.
  // `navigation.setParams` targets this screen's route even while it sits
  // beneath the cold-opened one (`router.setParams` would hit the focused one).
  const params = useLocalSearchParams<{ id?: string; itemId?: string }>();
  const navigation = useNavigation();
  useEffect(() => {
    if (params.id || params.itemId) {
      (navigation.setParams as unknown as (p: Record<string, undefined>) => void)({
        id: undefined,
        itemId: undefined,
      });
    }
  }, [params.id, params.itemId, navigation]);

  // Desktop two-pane (5.7c): the lists are in the sidebar, so the right pane
  // shows what to do next instead of a second copy of them.
  const twoPane = useTwoPane();
  return twoPane ? <HomePanePlaceholder /> : <HomeLists variant="page" />;
}
