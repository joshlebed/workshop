// The "who is this user" side panel shared by all three graph designs: identity,
// activity metrics and the friend list (each row re-selects that friend so you
// can walk the web without leaving the panel).

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import { Avatar, Button, Card, formatRelative, Text, tokens } from "@workshop/ui";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  ACTIVITY_BAND_LABEL,
  activityBand,
  displayName,
  formatDate,
  friendsOf,
  type InviteTree,
  subtreeSize,
} from "./model";

interface Props {
  data: AdminGraphResponse;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** When given, the panel also shows the inferred "brought in by" lineage. */
  tree?: InviteTree;
  /** Extra per-design line (e.g. "Community 3"). */
  extra?: string | null;
  /** Pan/zoom the open canvas to this user (hidden when the view can't). */
  onLocate?: (id: string) => void;
  /** Hand the user to the Tools tab's impersonation picker. */
  onImpersonate?: (node: AdminGraphNode) => void;
  style?: object;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text style={styles.statValue}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Text>
    </View>
  );
}

export function UserDetailPanel({
  data,
  selectedId,
  onSelect,
  tree,
  extra,
  onLocate,
  onImpersonate,
  style,
}: Props) {
  const router = useRouter();
  const nodesById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const node: AdminGraphNode | undefined = selectedId ? nodesById.get(selectedId) : undefined;
  const friends = useMemo(
    () => (node ? friendsOf(node.id, data.edges, nodesById) : []),
    [node, data.edges, nodesById],
  );

  if (!node) {
    return (
      <Card style={[styles.panel, style]} testID="admin-graph-panel-empty">
        <Text variant="label">Pick a user</Text>
        <Text tone="secondary" style={styles.gap}>
          Click any node to see who they are, how active they've been and who they're friends with.
          Click a friend in the list to jump to them.
        </Text>
        <View style={styles.summary}>
          <Stat label="Users" value={data.nodes.length} />
          <Stat label="Friendships" value={data.edges.length} />
          <Stat
            label="Avg friends"
            value={
              data.nodes.length === 0
                ? "—"
                : ((2 * data.edges.length) / data.nodes.length).toFixed(1)
            }
          />
        </View>
      </Card>
    );
  }

  const parentId = tree?.parent.get(node.id) ?? null;
  const parent = parentId ? nodesById.get(parentId) : undefined;
  const broughtIn = tree ? subtreeSize(tree, node.id) : null;
  const band = activityBand(node, new Date());

  return (
    <Card style={[styles.panel, style]} testID="admin-graph-panel">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <Avatar
            name={displayName(node)}
            imageUrl={userAvatarImageUrl(node.id, node.avatarVersion)}
            size="lg"
          />
          <View style={styles.identityText}>
            <Text variant="heading" numberOfLines={1} testID="admin-graph-panel-name">
              {displayName(node)}
              {node.isAdmin ? "  ★" : ""}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {node.email ?? "no email"}
            </Text>
            <Text variant="caption" tone="secondary">
              Joined {formatDate(node.createdAt)} · {ACTIVITY_BAND_LABEL[band]}
            </Text>
            {extra ? (
              <Text variant="caption" tone="secondary">
                {extra}
              </Text>
            ) : null}
          </View>
        </View>

        {tree ? (
          <Text tone="secondary" style={styles.lineage} testID="admin-graph-panel-lineage">
            {parent
              ? `Likely brought in by ${displayName(parent)} (generation ${tree.depth.get(node.id) ?? 0})`
              : "Seed user — joined without an older friend"}
            {broughtIn !== null && broughtIn > 0
              ? ` · brought in ${broughtIn} ${broughtIn === 1 ? "user" : "users"} downstream`
              : ""}
          </Text>
        ) : null}

        <View style={styles.statGrid}>
          <Stat label="Friends" value={node.friendCount} />
          <Stat label="Scores" value={node.scoreCount} />
          <Stat label="Games scored" value={node.gamesScored} />
          <Stat label="Games on home" value={node.gamesOnHome} />
          <Stat label="Active days (30d)" value={node.activeDays30} />
          <Stat label="Active days (all)" value={node.activeDaysTotal} />
          <Stat label="Last active" value={node.lastActiveDay ?? "—"} />
          <Stat label="First score" value={formatDate(node.firstScoreAt)} />
          <Stat label="Last score" value={formatDate(node.lastScoreAt)} />
          <Stat label="Platforms" value={node.platforms.length ? node.platforms.join(", ") : "—"} />
          <Stat label="Share sheet" value={node.usedShareExtension ? "yes" : "no"} />
          <Stat label="Pending in / out" value={`${node.pendingIn} / ${node.pendingOut}`} />
        </View>

        <View style={styles.friendsHeader}>
          <Text variant="label">Friends ({friends.length})</Text>
          <Text variant="caption" tone="muted">
            oldest first
          </Text>
        </View>
        {friends.length === 0 ? (
          <Text tone="muted" variant="caption">
            No friends yet.
          </Text>
        ) : (
          friends.map(({ node: f, since }) => (
            <Pressable
              key={f.id}
              onPress={() => onSelect(f.id)}
              style={({ pressed }) => [styles.friendRow, pressed && styles.friendRowPressed]}
              testID={`admin-graph-friend-${f.id}`}
              accessibilityRole="button"
            >
              <Avatar
                name={displayName(f)}
                imageUrl={userAvatarImageUrl(f.id, f.avatarVersion)}
                size="sm"
              />
              <View style={styles.friendText}>
                <Text numberOfLines={1}>{displayName(f)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {f.friendCount} friends · {f.scoreCount} scores · friends {formatRelative(since)}
                </Text>
              </View>
            </Pressable>
          ))
        )}

        <View style={styles.actions}>
          {onLocate ? (
            <Button
              label="Locate"
              variant="secondary"
              onPress={() => onLocate(node.id)}
              testID="admin-graph-locate"
            />
          ) : null}
          <Button
            label="Profile"
            variant="secondary"
            onPress={() => router.push(`/friends/${node.id}`)}
            testID="admin-graph-open-profile"
          />
          {onImpersonate && !node.isAdmin ? (
            <Button
              label="Impersonate"
              variant="ghost"
              onPress={() => onImpersonate(node)}
              testID="admin-graph-impersonate"
            />
          ) : null}
          <Button label="Clear" variant="ghost" onPress={() => onSelect(null)} />
        </View>
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { padding: tokens.space.md, minHeight: 200 },
  scroll: { gap: tokens.space.md },
  gap: { marginTop: tokens.space.sm },
  summary: { flexDirection: "row", gap: tokens.space.md, marginTop: tokens.space.md },
  identity: { flexDirection: "row", gap: tokens.space.md, alignItems: "center" },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  lineage: { fontSize: tokens.font.size.sm },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  stat: {
    flexBasis: "30%",
    flexGrow: 1,
    backgroundColor: tokens.bg.elevated,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    gap: 2,
  },
  statValue: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.semibold },
  friendsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  friendRowPressed: { backgroundColor: tokens.bg.elevated },
  friendText: { flex: 1, minWidth: 0 },
  actions: {
    flexDirection: "row",
    gap: tokens.space.sm,
    marginTop: tokens.space.sm,
    flexWrap: "wrap",
  },
});
