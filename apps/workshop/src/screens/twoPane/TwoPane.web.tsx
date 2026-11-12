import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ListListResponse } from "@workshop/shared";
import { tokens } from "@workshop/ui";
import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { fetchLists } from "../../api/lists";
import { useAuth } from "../../hooks/useAuth";
import { HomeLists } from "../home/HomeLists";
import { TWO_PANE_MIN_WIDTH, TWO_PANE_SIDEBAR_WIDTH } from "./twoPaneLayout";

const TwoPaneContext = createContext(false);

/** True while the lists sidebar is showing beside the current screen. */
export function useTwoPane(): boolean {
  return useContext(TwoPaneContext);
}

/**
 * Desktop web two-pane layout (UX pass 5.7c). At `TWO_PANE_MIN_WIDTH` and
 * up, the lists sit in a sidebar on the left and the `(lists)` stack (home,
 * a list, its items, add, settings) renders in the pane on the right. URLs,
 * history, deep links and reload are the stack's own: the sidebar is chrome
 * beside it, not a route. Below the breakpoint, and for someone with no
 * lists yet (the empty home teaches better full width), the tree is the
 * phone layout.
 *
 * The stack's element keeps the same position in the tree whether or not
 * the sidebar shows, so crossing the breakpoint never remounts the screens.
 */
export function TwoPaneShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const { token, status } = useAuth();
  // The same query (and cache entry) as the lists themselves.
  const lists = useQuery<ListListResponse>({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });
  const hasVisibleLists = !lists.data || lists.data.lists.some((l) => !l.archivedAt);
  const active =
    width >= TWO_PANE_MIN_WIDTH && status === "signed-in" && !!token && hasVisibleLists;

  return (
    <TwoPaneContext.Provider value={active}>
      <View style={styles.root}>
        {active ? (
          <View style={styles.sidebar}>
            <HomeLists variant="sidebar" />
          </View>
        ) : null}
        <View style={styles.pane}>{children}</View>
      </View>
    </TwoPaneContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: tokens.bg.canvas },
  sidebar: {
    width: TWO_PANE_SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: tokens.border.subtle,
  },
  pane: { flex: 1, minWidth: 0 },
});
