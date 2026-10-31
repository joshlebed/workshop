// The "List" view of the users tab: every HighScore user as a sortable row.
// Same data and selection as the three graph canvases, for when you want to
// scan numbers rather than shapes. Works on native too (plain RN views).

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { AdminGraphNode, AdminGraphResponse } from "@workshop/shared";
import { Avatar, Text, tokens } from "@workshop/ui";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  ACTIVITY_BAND_LABEL,
  activityBand,
  displayName,
  sortUsers,
  type UserSortKey,
} from "./model";

interface Props {
  data: AdminGraphResponse;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  height: number;
  /** Narrows to users whose name/email contains it. */
  filter?: string;
}

const COLUMNS: { key: UserSortKey; label: string; width: number; numeric?: boolean }[] = [
  { key: "name", label: "User", width: 220 },
  { key: "friendCount", label: "Friends", width: 72, numeric: true },
  { key: "scoreCount", label: "Scores", width: 72, numeric: true },
  { key: "gamesScored", label: "Games", width: 64, numeric: true },
  { key: "activeDays30", label: "Active 30d", width: 86, numeric: true },
  { key: "lastActiveDay", label: "Last active", width: 110 },
  { key: "createdAt", label: "Joined", width: 110 },
];

const BAND_COLORS = {
  week: tokens.status.success,
  month: tokens.accent.default,
  dormant: tokens.list.slate,
  never: tokens.border.strong,
} as const;

function cell(node: AdminGraphNode, key: UserSortKey): string {
  switch (key) {
    case "name":
      return displayName(node);
    case "friendCount":
      return String(node.friendCount);
    case "scoreCount":
      return node.scoreCount.toLocaleString();
    case "gamesScored":
      return String(node.gamesScored);
    case "activeDays30":
      return String(node.activeDays30);
    case "lastActiveDay":
      return node.lastActiveDay ?? "—";
    case "createdAt":
      return node.createdAt.slice(0, 10);
  }
}

export function UsersTable({ data, selectedId, onSelect, height, filter }: Props) {
  const [sortKey, setSortKey] = useState<UserSortKey>("lastActiveDay");
  const [desc, setDesc] = useState(true);
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(() => {
    const q = (filter ?? "").trim().toLowerCase();
    const filtered = q
      ? data.nodes.filter(
          (n) =>
            displayName(n).toLowerCase().includes(q) || (n.email ?? "").toLowerCase().includes(q),
        )
      : data.nodes;
    return sortUsers(filtered, sortKey, desc);
  }, [data.nodes, filter, sortKey, desc]);

  const onHeader = (key: UserSortKey) => {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(key !== "name");
    }
  };

  return (
    <View style={[styles.frame, { height }]} testID="admin-users-table">
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.hScroll}>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            {COLUMNS.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => onHeader(c.key)}
                style={[styles.cell, { width: c.width }, c.numeric && styles.numeric]}
                accessibilityRole="button"
                testID={`admin-users-sort-${c.key}`}
              >
                <Text variant="caption" tone={sortKey === c.key ? "primary" : "muted"}>
                  {c.label}
                  {sortKey === c.key ? (desc ? " ↓" : " ↑") : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView showsVerticalScrollIndicator>
            {rows.map((n) => {
              const selected = n.id === selectedId;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => onSelect(selected ? null : n.id)}
                  style={({ pressed }) => [
                    styles.row,
                    selected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  testID={`admin-users-row-${n.id}`}
                >
                  {COLUMNS.map((c) =>
                    c.key === "name" ? (
                      <View key={c.key} style={[styles.cell, styles.nameCell, { width: c.width }]}>
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: BAND_COLORS[activityBand(n, now)] },
                          ]}
                          accessibilityLabel={ACTIVITY_BAND_LABEL[activityBand(n, now)]}
                        />
                        <Avatar
                          name={displayName(n)}
                          imageUrl={userAvatarImageUrl(n.id, n.avatarVersion)}
                          size="sm"
                        />
                        <View style={styles.nameText}>
                          <Text numberOfLines={1}>
                            {displayName(n)}
                            {n.isAdmin ? " ★" : ""}
                          </Text>
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {n.email ?? "—"}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View
                        key={c.key}
                        style={[styles.cell, { width: c.width }, c.numeric && styles.numeric]}
                      >
                        <Text
                          variant="caption"
                          tone={c.key === "lastActiveDay" && !n.lastActiveDay ? "muted" : "primary"}
                        >
                          {cell(n, c.key)}
                        </Text>
                      </View>
                    ),
                  )}
                </Pressable>
              );
            })}
            {rows.length === 0 ? (
              <Text variant="caption" tone="muted" style={styles.empty}>
                No users match.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.canvas,
    overflow: "hidden",
  },
  hScroll: { flexGrow: 1 },
  table: { flex: 1, minWidth: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  headerRow: { backgroundColor: tokens.bg.surface, paddingVertical: tokens.space.xs },
  rowSelected: { backgroundColor: tokens.accent.muted },
  rowPressed: { backgroundColor: tokens.bg.elevated },
  cell: { paddingVertical: tokens.space.sm, paddingHorizontal: tokens.space.xs },
  numeric: { alignItems: "flex-end" },
  nameCell: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  nameText: { flex: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { padding: tokens.space.lg, textAlign: "center" },
});
