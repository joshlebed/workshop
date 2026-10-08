// One line of the day's scoreboard — the "box score" row for a game. Top
// line: cover · title · turnout, and on the right *my* cell (my rank and
// score once posted, a lit POST sign on today while I haven't, a quiet dash
// on a past day). Second line: the rank strip. The whole row opens the
// game's board; faces open people; POST opens the paste sheet in place.
//
// Pure presentation; the home screen distils the data and owns every action.

import type { GameStandingsEntry } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { memo } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../theme";
import { stripScoreLabel } from "../lib/stripScore";
import { RankStrip } from "./RankStrip";

export interface GameResultRowProps {
  gameId: string;
  title: string;
  iconUrl: string | null;
  /** Players with a score, in server order (rank-sorted). */
  entries: GameStandingsEntry[];
  selfId: string | null;
  viewingToday: boolean;
  streak: number;
  loading?: boolean;
  isDragging?: boolean;
  onPress: () => void;
  onPressPlayer: (userId: string) => void;
  /** Today-only: open the paste sheet for this game. */
  onPost?: () => void;
  onLongPress?: () => void;
  onMenu: () => void;
}

export const GameResultRow = memo(function GameResultRow({
  gameId,
  title,
  iconUrl,
  entries,
  selfId,
  viewingToday,
  streak,
  loading = false,
  isDragging = false,
  onPress,
  onPressPlayer,
  onPost,
  onLongPress,
  onMenu,
}: GameResultRowProps) {
  const mine = selfId ? entries.find((e) => e.userId === selfId) : undefined;
  const played = entries.length;
  const turnout =
    played === 0
      ? viewingToday
        ? "No plays yet"
        : "No plays"
      : `${played} played${viewingToday ? " today" : ""}`;

  return (
    <Pressable
      // No `accessibilityRole="button"` on the container: it holds real
      // buttons (faces, POST, menu) and RN-Web would nest <button>s.
      accessibilityLabel={`${title}, ${turnout}`}
      onPress={onPress}
      {...(onLongPress ? { onLongPress, delayLongPress: 500 } : {})}
      testID={`game-row-${gameId}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.root,
        (pressed || hovered) && styles.rootHover,
        isDragging && styles.rootDragging,
      ]}
    >
      <View style={styles.titleLine}>
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={styles.cover} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
          </View>
        )}
        <View style={styles.titleText} testID={`game-row-title-${gameId}`}>
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <View style={styles.metaRow}>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {turnout}
            </Text>
            {streak >= STREAK_MIN_DAYS ? (
              <Text variant="caption" tone="success" testID={`game-row-streak-${gameId}`}>
                {" "}
                · 🔥{streak}
              </Text>
            ) : null}
          </View>
        </View>

        {mine ? (
          <View style={styles.myCell} testID={`game-row-mine-${gameId}`}>
            <Text
              variant="score"
              tone={mine.rank === 1 ? "spotlight" : "primary"}
              style={styles.myRank}
            >
              {mine.rank != null ? `#${mine.rank}` : "–"}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {stripScoreLabel(mine)}
            </Text>
          </View>
        ) : viewingToday && onPost ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Post your ${title} score`}
            onPress={onPost}
            hitSlop={6}
            testID={`game-row-post-${gameId}`}
            style={({ pressed }) => [styles.post, pressed && styles.postPressed]}
          >
            <Text variant="heading" tone="link" style={styles.postText}>
              Post
            </Text>
          </Pressable>
        ) : (
          <View style={styles.myCell}>
            <Text variant="score" tone="muted" style={styles.myRank}>
              –
            </Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} options`}
          onPress={onMenu}
          hitSlop={8}
          testID={`game-row-menu-${gameId}`}
          style={({ pressed }) => [styles.menu, pressed && styles.menuPressed]}
        >
          <PixelIcon name="more-horizontal" size={16} color={tokens.text.secondary} />
        </Pressable>
      </View>

      <View style={styles.stripLine}>
        {loading ? (
          <View style={styles.skeleton} />
        ) : entries.length === 0 ? (
          <Text variant="caption" tone="muted">
            {viewingToday ? "Be the first — paste a result." : "Nobody posted."}
          </Text>
        ) : (
          <RankStrip
            entries={entries}
            selfId={selfId}
            onPressPlayer={onPressPlayer}
            testIDPrefix={`game-row-player-${gameId}`}
          />
        )}
      </View>
    </Pressable>
  );
});

const COVER = 32;

const styles = StyleSheet.create({
  root: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    gap: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  rootHover: { backgroundColor: tokens.bg.surface },
  rootDragging: {
    backgroundColor: tokens.bg.elevated,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  titleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  cover: { width: COVER, height: COVER, backgroundColor: tokens.bg.elevated },
  coverPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 11, lineHeight: 16 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  myCell: { alignItems: "flex-end", minWidth: 44 },
  myRank: { fontSize: 14, lineHeight: 20 },
  post: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  postPressed: { backgroundColor: tokens.accent.muted },
  postText: { fontSize: 10, lineHeight: 14 },
  menu: { width: 28, height: 36, alignItems: "center", justifyContent: "center" },
  menuPressed: { backgroundColor: tokens.bg.elevated },
  stripLine: { paddingLeft: COVER + tokens.space.sm, minHeight: 20, justifyContent: "center" },
  skeleton: { height: 36, width: 160, backgroundColor: tokens.bg.surface },
});
