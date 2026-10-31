// HighScore's admin dashboard — one screen for everything operator-only:
//   Overview  → analytics (DAU/MAU, scores, requests) from `AnalyticsPanel`
//   Users     → the friend graph in three designs + a sortable list, with a
//               shared find-a-user box and detail panel
//   Tools     → impersonation
// Tabs live in the URL (`/admin?tab=users`) so links and back/forward work.
// The server gates every endpoint (403 for non-admins); `user.isAdmin` only
// decides whether to render the dashboard or the "admins only" note. Not
// wrapped in `Screen`: the graph wants the whole viewport, so the dashboard
// manages its own (wider) column.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AdminGraphResponse } from "@workshop/shared";
import { Button, Card, IconButton, Sheet, Text, tokens, useTheme } from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AnalyticsPanel } from "../admin/AnalyticsPanel";
import { ClusterGraphView } from "../admin/graph/ClusterGraphView";
import { ForceGraphView } from "../admin/graph/ForceGraphView";
import { displayName, type GraphPalette, inferInviteTree } from "../admin/graph/model";
import { TreeGraphView } from "../admin/graph/TreeGraphView";
import { UserDetailPanel } from "../admin/graph/UserDetailPanel";
import { UserSearch } from "../admin/graph/UserSearch";
import { UsersTable } from "../admin/graph/UsersTable";
import { ImpersonationPanel } from "../admin/ImpersonationPanel";
import { fetchAdminGraph } from "../api/admin";
import { useAuth } from "../hooks/useAuth";

type Tab = "overview" | "users" | "tools";
type UsersView = "force" | "clusters" | "tree" | "list";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "tools", label: "Tools" },
];

// `nativeHint` describes the iOS canvases, which pan/pinch/tap instead of
// drag-nodes/scroll/hover and draw the invite tree without arrowheads.
const VIEWS: { key: UsersView; label: string; hint: string; nativeHint: string }[] = [
  {
    key: "force",
    label: "Growth",
    hint: "Drag the timeline or press ▶ to replay sign-ups and friendships. Colour = join month or activity; size = scores. Drag nodes, scroll to zoom.",
    nativeHint:
      "Drag the timeline or press ▶ to replay sign-ups and friendships. Colour = join month or activity; size = scores. Drag to pan, pinch to zoom, tap a user for details.",
  },
  {
    key: "clusters",
    label: "Groups",
    hint: "Friend groups found by community detection, each named after its best-connected member. Hover to light up a neighbourhood; size = friends.",
    nativeHint:
      "Friend groups found by community detection, each named after its best-connected member. Tap a user to light up their neighbourhood; size = friends. Drag to pan, pinch to zoom.",
  },
  {
    key: "tree",
    label: "Invite tree",
    hint: "Who brought whom: a user's parent is the older account in their earliest friendship. Seeds in the middle, arrows point to newcomers.",
    nativeHint:
      "Who brought whom: a user's parent is the older account in their earliest friendship. Seeds in the middle, newcomers on the outer rings; tap a user to light their lineage.",
  },
  {
    key: "list",
    label: "List",
    hint: "Every user as a row. Click a column to sort; the dot is activity (green this week, amber this month, grey dormant).",
    nativeHint:
      "Every user as a row. Tap a column to sort; the dot is activity (green this week, amber this month, grey dormant).",
  },
];

const SERIES = [
  "#F5A524",
  "#4CA7E8",
  "#3DD68C",
  "#A78BFA",
  "#F472B6",
  "#D4B896",
  "#94A3B8",
  "#F05252",
];

const WIDE_BREAKPOINT = 960;
const PANEL_WIDTH = 340;
const MAX_WIDTH = 1440;

function isTab(v: unknown): v is Tab {
  return v === "overview" || v === "users" || v === "tools";
}
function isUsersView(v: unknown): v is UsersView {
  return v === "force" || v === "clusters" || v === "tree" || v === "list";
}

export default function Admin() {
  const { user, token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string; view?: string; user?: string }>();
  const { width, height } = useWindowDimensions();
  const isAdmin = Boolean(user?.isAdmin);
  const wide = width >= WIDE_BREAKPOINT;

  const tab: Tab = isTab(params.tab) ? params.tab : "overview";
  const view: UsersView = isUsersView(params.view) ? params.view : "force";
  const setTab = (next: Tab) => router.setParams({ tab: next });
  const setView = (next: UsersView) => router.setParams({ tab: "users", view: next });

  const [selectedId, setSelectedId] = useState<string | null>(
    typeof params.user === "string" ? params.user : null,
  );
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [impersonateQuery, setImpersonateQuery] = useState("");

  const graphQuery = useQuery<AdminGraphResponse>({
    queryKey: queryKeys.admin.graph,
    queryFn: () => fetchAdminGraph(token),
    enabled: isAdmin && Boolean(token) && tab === "users",
    staleTime: 60_000,
  });

  const palette = useMemo<GraphPalette>(
    () => ({
      canvas: theme.bg.canvas,
      surface: theme.bg.surface,
      text: theme.text.primary,
      muted: theme.text.secondary,
      border: theme.border.default,
      accent: theme.accent.default,
      series: SERIES,
    }),
    [theme],
  );

  const onSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id && !wide) setSheetOpen(true);
    },
    [wide],
  );
  const locate = useCallback((id: string) => {
    setSelectedId(id);
    setFocus({ id, nonce: Date.now() });
  }, []);
  // Keep the selected user in the URL so a refresh or a shared link lands on them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: router is stable; only react to selection
  useEffect(() => {
    router.setParams({ user: selectedId ?? undefined });
  }, [selectedId]);

  const tree = useMemo(
    () => (graphQuery.data ? inferInviteTree(graphQuery.data) : null),
    [graphQuery.data],
  );
  // On native the Users tab is a fixed, non-scrolling column so the canvas
  // owns pan/pinch; on web the body scrolls as usual.
  const nativeUsers = tab === "users" && Platform.OS !== "web";
  // Native: the canvas fills what's left of the (non-scrolling) body below
  // the toolbar, above the home indicator. Measured, because the header,
  // tabs and wrapped hint above it vary in height.
  const insets = useSafeAreaInsets();
  const [bodyHeight, setBodyHeight] = useState(0);
  const [canvasTop, setCanvasTop] = useState(0);
  const canvasHeight = nativeUsers
    ? bodyHeight > 0 && canvasTop > 0
      ? Math.max(320, bodyHeight - canvasTop - Math.max(insets.bottom, tokens.space.md))
      : Math.max(320, height - 330)
    : Math.max(420, Math.min(820, height - 250));
  const activeView = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  const onSessionChanged = useCallback(() => {
    queryClient.clear();
    router.replace("/");
  }, [queryClient, router]);

  const renderUsersCanvas = (data: AdminGraphResponse) => {
    const props = { data, selectedId, onSelect, focus, height: canvasHeight, palette };
    switch (view) {
      case "clusters":
        return <ClusterGraphView key="clusters" {...props} />;
      case "tree":
        return <TreeGraphView key="tree" {...props} />;
      case "list":
        return (
          <UsersTable
            key="list"
            data={data}
            selectedId={selectedId}
            onSelect={onSelect}
            height={canvasHeight}
            filter={search}
          />
        );
      default:
        return <ForceGraphView key="force" {...props} />;
    }
  };

  const renderDetail = (data: AdminGraphResponse, style: object) => (
    <UserDetailPanel
      data={data}
      selectedId={selectedId}
      onSelect={(id) => {
        setSelectedId(id);
        if (id) setFocus({ id, nonce: Date.now() });
      }}
      onLocate={
        view === "list"
          ? undefined
          : (id: string) => {
              locate(id);
              // On a phone the sheet covers the canvas; close it to show the move.
              setSheetOpen(false);
            }
      }
      onImpersonate={(node) => {
        setImpersonateQuery(node.email ?? displayName(node));
        setSheetOpen(false);
        setTab("tools");
      }}
      tree={view === "tree" && tree ? tree : undefined}
      style={style}
    />
  );

  const tabsRow = (
    <View style={styles.tabs} testID="admin-tabs">
      {TABS.map((t) => (
        <Pressable
          key={t.key}
          onPress={() => setTab(t.key)}
          style={[styles.tab, tab === t.key && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t.key }}
          testID={`admin-tab-${t.key}`}
        >
          <Text variant="label" tone={tab === t.key ? "primary" : "muted"}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.root} testID="admin">
      <View style={styles.column}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="caption" tone="muted" style={styles.headerEyebrow}>
              HighScore
            </Text>
            <Text variant="heading" numberOfLines={1}>
              Admin
            </Text>
          </View>
          {isAdmin && wide ? tabsRow : null}
          <IconButton
            accessibilityLabel="Close admin"
            onPress={() => goBack("/")}
            testID="admin-close"
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </IconButton>
        </View>
        {isAdmin && !wide ? <View style={styles.tabsRowNarrow}>{tabsRow}</View> : null}

        {!isAdmin ? (
          <View style={styles.body}>
            <Card>
              <Text variant="heading">Admins only</Text>
              <Text tone="secondary" style={styles.gap}>
                This dashboard is only available to HighScore admins.
              </Text>
            </Card>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!nativeUsers}
            onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}
          >
            {tab === "overview" ? <AnalyticsPanel /> : null}

            {tab === "tools" ? (
              <ImpersonationPanel
                key={impersonateQuery}
                onSessionChanged={onSessionChanged}
                initialQuery={impersonateQuery}
              />
            ) : null}

            {tab === "users" ? (
              <>
                <View style={styles.toolbar}>
                  <View style={styles.segment} testID="admin-users-views">
                    {VIEWS.map((v) => (
                      <Pressable
                        key={v.key}
                        onPress={() => setView(v.key)}
                        style={[styles.segmentItem, view === v.key && styles.segmentActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: view === v.key }}
                        testID={`admin-users-view-${v.key}`}
                      >
                        <Text variant="label" tone={view === v.key ? "primary" : "muted"}>
                          {v.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {graphQuery.data ? (
                    <UserSearch
                      nodes={graphQuery.data.nodes}
                      value={search}
                      onChange={setSearch}
                      onPick={(id) => {
                        locate(id);
                        if (!wide) setSheetOpen(true);
                      }}
                      placeholder={
                        view === "list" ? "Filter users" : "Find a user by name or email"
                      }
                    />
                  ) : null}
                </View>
                <Text variant="caption" tone="secondary" testID="admin-users-hint">
                  {Platform.OS === "web" ? activeView?.hint : activeView?.nativeHint}
                </Text>

                {graphQuery.isError ? (
                  <Card>
                    <Text tone="danger">{errorMessage(graphQuery.error)}</Text>
                    <Button
                      label="Retry"
                      variant="secondary"
                      onPress={() => void graphQuery.refetch()}
                      style={styles.gap}
                    />
                  </Card>
                ) : null}
                {graphQuery.isLoading ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={tokens.accent.default} />
                  </View>
                ) : null}

                {graphQuery.data ? (
                  <>
                    <View
                      style={[styles.layout, wide ? styles.layoutWide : styles.layoutNarrow]}
                      onLayout={(e) => setCanvasTop(e.nativeEvent.layout.y)}
                    >
                      <View style={styles.canvas}>{renderUsersCanvas(graphQuery.data)}</View>
                      {wide
                        ? renderDetail(graphQuery.data, {
                            width: PANEL_WIDTH,
                            maxHeight: canvasHeight,
                          })
                        : null}
                    </View>
                    {!wide ? (
                      <Sheet
                        visible={sheetOpen && selectedId !== null}
                        onRequestClose={() => setSheetOpen(false)}
                        testID="admin-user-sheet"
                      >
                        {renderDetail(graphQuery.data, {
                          borderWidth: 0,
                          padding: 0,
                          maxHeight: height * 0.75,
                        })}
                      </Sheet>
                    ) : null}
                    <Text variant="caption" tone="muted" style={styles.footer}>
                      {graphQuery.data.nodes.length} users · {graphQuery.data.edges.length}{" "}
                      friendships · computed{" "}
                      {new Date(graphQuery.data.generatedAt).toLocaleString()}
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center" },
  column: { flex: 1, width: "100%", maxWidth: MAX_WIDTH },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.md,
    gap: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  tabsRowNarrow: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.md },
  headerEyebrow: { letterSpacing: 0.4, textTransform: "uppercase" },
  tabs: {
    flexDirection: "row",
    gap: tokens.space.xs,
    backgroundColor: tokens.bg.surface,
    borderRadius: tokens.radius.pill,
    padding: 3,
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: tokens.radius.pill,
  },
  tabActive: { backgroundColor: tokens.bg.elevated },
  closeGlyph: { fontSize: 18, color: tokens.text.secondary },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    flexWrap: "wrap",
    zIndex: 20,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: tokens.bg.surface,
    borderRadius: tokens.radius.md,
    padding: 3,
    gap: 2,
  },
  segmentItem: {
    paddingVertical: 7,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.sm,
  },
  segmentActive: { backgroundColor: tokens.bg.elevated },
  loading: { paddingVertical: tokens.space.xl, alignItems: "center" },
  layout: { gap: tokens.space.md },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  layoutNarrow: { flexDirection: "column" },
  canvas: { flex: 1, minWidth: 0 },
  gap: { marginTop: tokens.space.sm },
  footer: { textAlign: "center", marginTop: tokens.space.sm },
});
