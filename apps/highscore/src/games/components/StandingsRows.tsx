// A game's standings as rows: rank, who, the share they pasted, and — right
// aligned in the pixel face — the one number the board actually ranks on.
//
// Daily-game shares are unruly ("98🎯 93🏆 79✨…", "Final score: 937"), so the
// raw text is context at reduced contrast on a single line, and the comparable
// number gets the column. Without that split the screen is a wall of somebody
// else's emoji pretending to be data.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar, PixelIcon, Text, tokens } from "../../theme";
import type { StandingCell } from "../lib/matrix";
import { ScoreReactions } from "./ScoreReactions";

interface StandingsRowsProps {
  cells: StandingCell[];
  /** Tap a row to open that player. Omitted inside their own profile. */
  onPressPlayer?: (userId: string) => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
  emptyLabel?: string;
  /** Cap for the peek's glance — the rest is one "+N" line. */
  limit?: number;
  /**
   * Let multi-line shares (Wordle grids, Tradle sparklines) breathe. Off in the
   * peek, on for the board — a grid squeezed to one line is just noise.
   */
  expandGrids?: boolean;
  /** Edit / clear, rendered on the viewer's own row where they belong. */
  selfActions?: ReactNode;
  testIDPrefix?: string;
}

export function StandingsRows({
  cells,
  onPressPlayer,
  onReact,
  onOpenReactionPicker,
  emptyLabel = "No plays yet",
  limit,
  expandGrids = false,
  selfActions,
  testIDPrefix = "standing",
}: StandingsRowsProps) {
  const shown = limit ? cells.slice(0, limit) : cells;
  const hidden = cells.length - shown.length;
  if (cells.length === 0) {
    return (
      <Text variant="caption" tone="secondary" style={styles.empty}>
        {emptyLabel}
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {shown.map((cell) => {
        const full = cell.displayName?.trim() || "Someone";
        // First name only — the score is the point of the row, not the surname.
        const name = cell.isSelf ? "You" : (full.split(/\s+/)[0] ?? full);
        const canReact = !cell.isSelf && !!onOpenReactionPicker;
        // Grids are worth their height; a one-line summary is not.
        const bodyLines = expandGrids && cell.body?.includes("\n") ? 4 : 1;
        return (
          <View
            key={cell.userId}
            style={cell.isSelf ? styles.selfBlock : undefined}
            testID={`${testIDPrefix}-row-${cell.userId}`}
          >
            <View style={styles.row}>
              <View style={styles.rank}>
                {cell.rank === 1 ? (
                  <PixelIcon name="crown" size={16} color={tokens.neon.yellow} />
                ) : (
                  <Text variant="cell" tone="secondary">
                    {cell.rank ?? "·"}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityRole={onPressPlayer && !cell.isSelf ? "button" : "text"}
                accessibilityLabel={`${cell.isSelf ? "You" : full}: ${cell.body ?? "played"}`}
                onPress={
                  onPressPlayer && !cell.isSelf ? () => onPressPlayer(cell.userId) : undefined
                }
                style={({ pressed }) => [styles.who, pressed && styles.whoPressed]}
              >
                <Avatar
                  name={cell.displayName}
                  imageUrl={userAvatarImageUrl(cell.userId)}
                  size="sm"
                />
                <Text variant="label" numberOfLines={1} style={styles.name}>
                  {name}
                </Text>
              </Pressable>
              <Text variant="mono" numberOfLines={bodyLines} style={styles.body}>
                {cell.body ?? "played"}
              </Text>
              <Text
                variant="cell"
                style={cell.outrightFirst ? styles.markFirst : styles.mark}
                testID={`${testIDPrefix}-score-${cell.userId}`}
              >
                {cell.mark ?? "—"}
              </Text>
              {cell.reactions.length > 0 || canReact ? (
                <ScoreReactions
                  reactions={cell.reactions}
                  testIDPrefix={`${testIDPrefix}-react-${cell.userId}`}
                  {...(canReact && onReact
                    ? {
                        onToggle: (emoji: string, cur: boolean) => onReact(cell.userId, emoji, cur),
                      }
                    : {})}
                  {...(canReact && onOpenReactionPicker
                    ? { onAdd: () => onOpenReactionPicker(cell.userId) }
                    : {})}
                />
              ) : null}
            </View>
            {cell.isSelf && selfActions ? (
              <View style={styles.selfActions}>{selfActions}</View>
            ) : null}
          </View>
        );
      })}
      {hidden > 0 ? (
        <Text variant="caption" tone="secondary" style={styles.more}>
          +{hidden} more
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: tokens.space.xs },
  empty: { paddingVertical: tokens.space.sm },
  more: { paddingTop: tokens.space.xs, paddingLeft: 18 + tokens.space.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
  },
  selfBlock: {
    backgroundColor: tokens.bg.raised,
    paddingBottom: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
  },
  selfActions: { flexDirection: "row", justifyContent: "flex-end" },
  rank: { width: 18, alignItems: "center", paddingTop: 2 },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    width: 88,
    paddingTop: 1,
  },
  whoPressed: { opacity: 0.6 },
  name: { flex: 1, minWidth: 0, color: tokens.text.primary },
  body: { flex: 1, minWidth: 0, color: tokens.text.secondary },
  mark: {
    minWidth: 40,
    textAlign: "right",
    color: tokens.text.primary,
    letterSpacing: 0,
    paddingTop: 2,
  },
  markFirst: {
    minWidth: 40,
    textAlign: "right",
    color: tokens.neon.yellow,
    letterSpacing: 0,
    paddingTop: 2,
  },
});
