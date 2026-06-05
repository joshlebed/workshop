// Rich leaderboard "status card" — one per game in a leaderboard list.
//
// Replaces the plain ItemRow on leaderboard lists so the whole standings for
// today read at a glance, without drilling into each game. One card == one
// game; the body taps through to the game-detail day-rail history.
//
// Pure presentation. Both ItemList implementations (native
// react-native-reorderable-list, web @dnd-kit) compose this inside their own
// drag-aware wrappers exactly as they do ItemRow: long-press the card body to
// reorder on native; web drags via the wrapper's pointer listeners. The cover,
// menu, Play and paste controls are their own Pressables so a tap on them
// never starts a drag or a body-tap.
//
// Each player's score renders through `summarizeScoreBody` — the SAME distiller
// that builds the "copy today's scores" clipboard recap — so a row's score
// block is identical to what the share copy shows (a hard product
// requirement), grids and all.

import type { Item, LeaderboardEntry, ListMemberSummary } from "@workshop/shared";
import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { summarizeScoreBody } from "../../lib/scoresSummary";
import { Avatar, Text, tokens } from "../../ui/index";

const TOP_N = 5;
const RANK_SLOT = 20;
const AVATAR_SM = 24;
// The score block aligns under the player's name: rank slot + gap + avatar + gap.
const SCORE_INDENT = RANK_SLOT + tokens.space.sm + AVATAR_SM + tokens.space.sm;

export interface GameLeaderboardCardProps {
  item: Item;
  section: "ordered" | "unordered" | "completed";
  isDragging: boolean;
  /** List hue — tints the cover placeholder only (identity, per DESIGN.md). */
  accent: string;
  /**
   * Today's scored players for this game, already server-ranked. Unplayed
   * members are NOT included — the list-scores endpoint only returns rows that
   * have a score — so "who hasn't played" is derived against `members`.
   */
  entries: LeaderboardEntry[];
  /** Full member roster — the "of N" denominator + the dimmed empty facepile. */
  members: ListMemberSummary[];
  selfId: string | null;
  /** Scores still loading — show skeleton standings, not a 0-turnout card. */
  loading?: boolean;
  /** Tap the title or standings → game detail. */
  onPressBody?: () => void;
  /** Long-press the body → reorder (native only; web drags via the wrapper). */
  onLongPressBody?: () => void;
  onMenu: () => void;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlay: () => void;
  /** Manual paste fallback — opens the paste sheet without leaving the page. */
  onPaste: () => void;
}

function gameCover(item: Item): { imageUrl?: string; glyph: string } {
  const c = item.content as Record<string, unknown>;
  const image =
    typeof c.imageProxy === "string"
      ? c.imageProxy
      : typeof c.image === "string"
        ? c.image
        : typeof c.thumbnailUrl === "string"
          ? c.thumbnailUrl
          : undefined;
  return { ...(image ? { imageUrl: image } : {}), glyph: "🎮" };
}

function hasScore(entry: LeaderboardEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

// The list-scores endpoint assigns ranks but returns entries in join order, not
// rank order (only the per-item endpoint sorts in SQL). Sort here so the
// standings read top-down; unranked-but-played rows (no score regex) sort last.
function byRank(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.rank == null && b.rank == null) return 0;
  if (a.rank == null) return 1;
  if (b.rank == null) return -1;
  return a.rank - b.rank;
}

export const GameLeaderboardCard = memo(function GameLeaderboardCard({
  item,
  isDragging,
  accent,
  entries,
  members,
  selfId,
  loading,
  onPressBody,
  onLongPressBody,
  onMenu,
  onPlay,
  onPaste,
}: GameLeaderboardCardProps) {
  const cover = gameCover(item);
  const scored = entries.filter(hasScore).sort(byRank);
  const total = members.length;
  const playedCount = scored.length;

  const myEntry = selfId ? entries.find((e) => e.userId === selfId) : undefined;
  const iPlayed = !!(myEntry && hasScore(myEntry));

  // Top N by server rank, plus a pinned "you" row when the viewer played but
  // ranks outside the cut — the common leaderboard courtesy of always showing
  // people their own standing.
  const topRows = scored.slice(0, TOP_N);
  const selfInTop = selfId ? topRows.some((e) => e.userId === selfId) : false;
  const pinnedSelf = !selfInTop && iPlayed ? myEntry : undefined;
  const overflow = scored.slice(TOP_N).filter((e) => e.userId !== selfId).length;

  const turnout =
    total === 0
      ? "No members yet"
      : playedCount === 0
        ? "No one's played yet"
        : playedCount === total
          ? "Everyone's played today"
          : `${playedCount} of ${total} played today`;

  return (
    <View style={[styles.card, isDragging && styles.cardDragging]} testID={`game-card-${item.id}`}>
      {/* Header: cover opens the game; the title block taps through to detail. */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Play ${item.title}`}
          onPress={onPlay}
          hitSlop={4}
          testID={`game-card-cover-${item.id}`}
          style={({ pressed }) => [styles.cover, pressed && styles.coverPressed]}
        >
          {cover.imageUrl ? (
            <Image
              source={{ uri: cover.imageUrl }}
              style={styles.coverImage}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={[
                styles.coverImage,
                styles.coverPlaceholder,
                { backgroundColor: `${accent}1F` },
              ]}
            >
              <Text style={styles.coverGlyph}>{cover.glyph}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.title} leaderboard`}
          onPress={onPressBody}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          testID={`game-card-body-${item.id}`}
          style={({ pressed, hovered }) => [
            styles.headerText,
            (pressed || hovered) && styles.bodyPressed,
          ]}
        >
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {item.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.turnout}>
            {turnout}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open menu for ${item.title}`}
          onPress={onMenu}
          hitSlop={10}
          testID={`game-card-menu-${item.id}`}
          style={({ pressed, hovered }) => [
            styles.menuBtn,
            (pressed || hovered) && styles.menuBtnHover,
          ]}
        >
          <Text style={styles.menuGlyph}>⋯</Text>
        </Pressable>
      </View>

      {/* Standings — long-press here also activates reorder on native. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.title}: ${turnout}`}
        onPress={onPressBody}
        onLongPress={onLongPressBody}
        delayLongPress={250}
        style={styles.standings}
      >
        {loading ? (
          <SkeletonRows />
        ) : playedCount === 0 ? (
          <EmptyStandings members={members} />
        ) : (
          <>
            {topRows.map((entry) => (
              <PlayerRow
                key={entry.userId}
                entry={entry}
                item={item}
                isMe={entry.userId === selfId}
              />
            ))}
            {pinnedSelf ? (
              <>
                <View style={styles.pinnedDivider} />
                <PlayerRow entry={pinnedSelf} item={item} isMe />
              </>
            ) : null}
            {overflow > 0 ? (
              <Text variant="caption" tone="muted" style={styles.moreLine}>
                +{overflow} more
              </Text>
            ) : null}
          </>
        )}
      </Pressable>

      {/* Play CTA — only when the viewer hasn't logged today's result. */}
      {!loading && !iPlayed && total > 0 ? (
        <View style={styles.cta}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${item.title}`}
            onPress={onPlay}
            testID={`game-card-play-${item.id}`}
            style={({ pressed, hovered }) => [
              styles.playBtn,
              (pressed || hovered) && styles.playBtnHover,
            ]}
          >
            <Text style={styles.playGlyph}>▶</Text>
            <Text style={styles.playLabel} numberOfLines={1}>
              Play {item.title}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paste your ${item.title} result`}
            onPress={onPaste}
            hitSlop={6}
            testID={`game-card-paste-${item.id}`}
            style={({ pressed, hovered }) => [
              styles.pasteLink,
              (pressed || hovered) && styles.pasteLinkHover,
            ]}
          >
            <Text variant="caption" tone="muted" style={styles.pasteLinkText}>
              or paste result
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

interface PlayerRowProps {
  entry: LeaderboardEntry;
  item: Item;
  isMe: boolean;
}

function PlayerRow({ entry, item, isMe }: PlayerRowProps) {
  const name = entry.displayName ?? "Someone";
  // Identical distillation to the clipboard recap: per-game grid, URLs stripped.
  // A URL-only share distills to nothing — show "Played" rather than echo a ref link.
  const body = summarizeScoreBody(item, entry);
  return (
    <View
      style={[styles.playerRow, isMe && styles.playerRowMe]}
      testID={`game-card-row-${entry.userId}`}
    >
      <View style={styles.nameLine}>
        <RankMark rank={entry.rank} />
        <Avatar name={entry.displayName} size="sm" />
        <Text variant="label" numberOfLines={1} style={styles.playerName}>
          {name}
        </Text>
        {isMe ? (
          <View style={styles.youPill}>
            <Text style={styles.youPillText}>you</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.scoreBody, body ? null : styles.scoreBodyMuted]}
        testID={`game-card-score-${entry.userId}`}
      >
        {body ?? "Played"}
      </Text>
    </View>
  );
}

function RankMark({ rank }: { rank: number | null }) {
  if (rank == null) {
    return (
      <View style={styles.rankSlot}>
        <Text style={styles.rankDot}>·</Text>
      </View>
    );
  }
  if (rank === 1) {
    return (
      <View style={[styles.rankSlot, styles.rankFirst]}>
        <Text style={styles.rankFirstText}>1</Text>
      </View>
    );
  }
  return (
    <View style={styles.rankSlot}>
      <Text style={styles.rankText}>{rank}</Text>
    </View>
  );
}

function EmptyStandings({ members }: { members: ListMemberSummary[] }) {
  const faces = members.slice(0, 5);
  return (
    <View style={styles.empty}>
      {faces.length > 0 ? (
        <View style={styles.facepile}>
          {faces.map((m, i) => (
            <View key={m.userId} style={[styles.faceWrap, i > 0 && styles.faceOverlap]}>
              <Avatar name={m.displayName} size="sm" />
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="caption" tone="muted" style={styles.emptyText}>
        Be the first to play today.
      </Text>
    </View>
  );
}

function SkeletonRows() {
  return (
    <View style={styles.skeletonWrap} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={styles.skeletonDot} />
          <View style={[styles.skeletonBar, { width: i === 0 ? "44%" : "32%" }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    marginBottom: tokens.space.md,
    gap: tokens.space.sm,
  },
  cardDragging: {
    backgroundColor: tokens.bg.elevated,
    borderColor: tokens.border.default,
    boxShadow: "0px 8px 18px rgba(0, 0, 0, 0.4)",
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  cover: { borderRadius: tokens.radius.md },
  coverPressed: { opacity: 0.7 },
  coverImage: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGlyph: { fontSize: 22 },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  bodyPressed: { backgroundColor: tokens.bg.elevated },
  title: { fontSize: tokens.font.size.md, letterSpacing: -0.1 },
  turnout: { letterSpacing: 0.1 },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  menuBtnHover: { backgroundColor: tokens.bg.elevated },
  menuGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.lg,
    lineHeight: tokens.font.size.lg,
  },
  standings: {
    gap: tokens.space.sm,
    paddingTop: tokens.space.xs,
  },
  playerRow: {
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  playerRowMe: { backgroundColor: `${tokens.accent.default}14` },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  rankSlot: {
    width: RANK_SLOT,
    height: RANK_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  rankDot: { color: tokens.text.muted, fontSize: tokens.font.size.md },
  rankFirst: {
    borderRadius: RANK_SLOT / 2,
    backgroundColor: tokens.accent.default,
  },
  rankFirstText: {
    color: tokens.text.onAccent,
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    fontVariant: ["tabular-nums"],
  },
  playerName: {
    flexShrink: 1,
    fontSize: tokens.font.size.sm,
    color: tokens.text.primary,
  },
  youPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.accent.muted,
  },
  youPillText: {
    fontSize: 10,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.5,
    color: tokens.accent.default,
    textTransform: "uppercase",
  },
  scoreBody: {
    paddingLeft: SCORE_INDENT,
    color: tokens.text.secondary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 5,
  },
  scoreBodyMuted: { color: tokens.text.muted, fontStyle: "italic" },
  pinnedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginVertical: tokens.space.xs,
    marginLeft: SCORE_INDENT,
  },
  moreLine: {
    paddingLeft: SCORE_INDENT,
    paddingTop: 2,
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xs,
  },
  facepile: { flexDirection: "row" },
  faceWrap: {
    borderWidth: 2,
    borderColor: tokens.bg.surface,
    borderRadius: 999,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  emptyText: { flex: 1 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingTop: tokens.space.xs,
  },
  playBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: `${tokens.accent.default}55`,
  },
  playBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  playGlyph: { color: tokens.accent.default, fontSize: 11 },
  playLabel: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    flexShrink: 1,
  },
  pasteLink: {
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  pasteLinkHover: { backgroundColor: tokens.bg.elevated },
  pasteLinkText: { textDecorationLine: "underline" },
  skeletonWrap: { gap: tokens.space.sm, paddingVertical: tokens.space.xs },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  skeletonDot: {
    width: AVATAR_SM,
    height: AVATAR_SM,
    borderRadius: AVATAR_SM / 2,
    backgroundColor: tokens.bg.elevated,
  },
  skeletonBar: {
    height: 10,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
});
