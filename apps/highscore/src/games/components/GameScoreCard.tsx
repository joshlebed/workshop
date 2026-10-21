// One game on the scoreboard — the home page's row unit.
//
//   ┌────────────────────────────────────────────────┐
//   │ [icon] MAPTAP                 🔥 3        [⋯]   │  title → box score
//   │ 6 PLAYED                      YOU · 1ST · 902   │  turnout · your placing / PASTE
//   │  1  [av] Josh ──────────────────────── 902      │  podium: top 3 by server rank
//   │  2  [av] Claire ────────────────────── 902      │
//   │  3  [av] Kay ───────────────────────── 880      │
//   │  6  [av] you ───────────────────────── 801  +2  │  pinned when you're outside the cut
//   └────────────────────────────────────────────────┘
//
// Presentational. Rows arrive in the server's order with the server's rank;
// nothing here sorts. Avatars and names open the player; everything else
// opens the game's box score. On native the whole card is also the reorder
// handle (long-press), the kebab excepted.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { GameStandingsEntry } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { REORDER_ACTIVATION } from "@workshop/ui";
import { memo } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Avatar, PixelIcon, Text, tokens } from "../../theme";
import { ordinal, shortScore } from "../lib/shortScore";

const PODIUM = 3;
const ICON = 28;

export interface GameScoreCardProps {
  gameId: string;
  title: string;
  iconUrl: string | null;
  /** Players with a score for the viewed day, server order, server rank. */
  entries: GameStandingsEntry[];
  selfId: string | null;
  /** Viewer's current streak (today-pinned; 0 = none). */
  streak: number;
  /** The card is showing today — gates the PASTE affordance. */
  isToday: boolean;
  loading: boolean;
  isDragging: boolean;
  /** You are the only one who has this game in rotation (no friend plays it). */
  soloGame: boolean;
  onPress: () => void;
  onPressPlayer: (userId: string) => void;
  onPaste: () => void;
  onMenu: () => void;
  onLongPressBody?: () => void;
}

export const GameScoreCard = memo(function GameScoreCard({
  gameId,
  title,
  iconUrl,
  entries,
  selfId,
  streak,
  isToday,
  loading,
  isDragging,
  soloGame,
  onPress,
  onPressPlayer,
  onPaste,
  onMenu,
  onLongPressBody,
}: GameScoreCardProps) {
  const scored = entries.filter((e) => e.scoreRaw != null && e.scoreRaw.length > 0);
  const me = selfId ? scored.find((e) => e.userId === selfId) : undefined;
  const podium = scored.slice(0, PODIUM);
  const meInPodium = !!me && podium.some((e) => e.userId === me.userId);
  const pinnedMe = me && !meInPodium ? me : null;
  const overflow = scored.length - podium.length - (pinnedMe ? 1 : 0);
  const played = scored.length;
  const nobody = !loading && played === 0;
  const longPress = onLongPressBody
    ? { onLongPress: onLongPressBody, delayLongPress: REORDER_ACTIVATION.longPressMs }
    : {};

  const turnout = loading
    ? ""
    : played === 0
      ? isToday
        ? soloGame
          ? "ONLY YOU PLAY THIS"
          : "NOBODY YET"
        : "NO PLAYS"
      : played === 1 && me
        ? isToday
          ? "YOU'RE FIRST IN"
          : "ONLY YOU"
        : `${played} PLAYED`;

  return (
    <View style={[styles.card, isDragging && styles.cardDragging]} testID={`game-card-${gameId}`}>
      {/* Title row */}
      <View style={styles.titleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${title}`}
          onPress={onPress}
          {...longPress}
          testID={`game-card-body-${gameId}`}
          style={({ pressed }) => [styles.titlePress, pressed && styles.pressed]}
        >
          {iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.icon} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.icon, styles.iconFallback]}>
              <PixelIcon name="gamepad" size={16} />
            </View>
          )}
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {streak >= STREAK_MIN_DAYS ? (
            <View style={styles.streak} testID={`game-card-streak-${gameId}`}>
              <PixelIcon name="zap" size={16} color={tokens.neon.chartreuse} />
              <Text style={styles.streakText}>{streak}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Menu for ${title}`}
          onPress={onMenu}
          hitSlop={8}
          testID={`game-card-menu-${gameId}`}
          style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
        >
          <PixelIcon name="more-horizontal" size={16} />
        </Pressable>
      </View>

      {/* Meta row: turnout on the left, your placing (or the paste CTA) on the right. */}
      <View style={styles.metaRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={turnout || `Open ${title}`}
          onPress={onPress}
          {...longPress}
          style={styles.metaLeft}
        >
          <Text style={[styles.turnout, nobody && styles.turnoutMuted]} numberOfLines={1}>
            {loading ? "LOADING" : turnout}
          </Text>
        </Pressable>
        {me ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`You placed ${me.rank ? ordinal(me.rank) : "unranked"} with ${shortScore(me)}`}
            onPress={onPress}
            {...longPress}
            style={styles.placing}
            testID={`game-card-placing-${gameId}`}
          >
            <Text style={styles.placingLabel}>YOU</Text>
            <Text style={[styles.placingRank, me.rank === 1 && styles.placingWin]}>
              {me.rank ? ordinal(me.rank) : "—"}
            </Text>
            <Text style={styles.placingScore}>{shortScore(me)}</Text>
          </Pressable>
        ) : isToday && !loading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paste your ${title} result`}
            onPress={onPaste}
            hitSlop={6}
            testID={`game-card-paste-${gameId}`}
            style={({ pressed }) => [styles.pasteBtn, pressed && styles.pasteBtnPressed]}
          >
            <Text style={styles.pasteText}>PASTE</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Podium */}
      {loading ? (
        <View style={styles.skeleton}>
          <View style={[styles.skeletonBar, { width: "52%" }]} />
          <View style={[styles.skeletonBar, { width: "38%" }]} />
        </View>
      ) : podium.length > 0 ? (
        <View style={styles.rows}>
          {podium.map((entry) => (
            <PodiumRow
              key={entry.userId}
              entry={entry}
              isMe={entry.userId === selfId}
              onPress={onPress}
              onPressPlayer={onPressPlayer}
              longPress={longPress}
            />
          ))}
          {pinnedMe ? (
            <>
              <View style={styles.pinnedRule} />
              <PodiumRow
                entry={pinnedMe}
                isMe
                onPress={onPress}
                onPressPlayer={onPressPlayer}
                longPress={longPress}
              />
            </>
          ) : null}
          {overflow > 0 ? (
            <Pressable accessibilityRole="button" onPress={onPress} {...longPress}>
              <Text style={styles.more}>+{overflow} MORE</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function PodiumRow({
  entry,
  isMe,
  onPress,
  onPressPlayer,
  longPress,
}: {
  entry: GameStandingsEntry;
  isMe: boolean;
  onPress: () => void;
  onPressPlayer: (userId: string) => void;
  longPress: { onLongPress?: () => void; delayLongPress?: number };
}) {
  const name = entry.displayName?.trim() || "Someone";
  const first = name.split(/\s+/)[0] ?? name;
  return (
    <View style={[styles.row, isMe && styles.rowMe]} testID={`game-card-row-${entry.userId}`}>
      <Text style={[styles.rank, entry.rank === 1 && styles.rankFirst]}>{entry.rank ?? "·"}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name}'s profile`}
        onPress={() => onPressPlayer(entry.userId)}
        {...longPress}
        hitSlop={4}
        testID={`game-card-avatar-${entry.userId}`}
        style={({ pressed }) => [styles.player, pressed && styles.pressed]}
      >
        <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="sm" />
        <Text variant="label" numberOfLines={1} style={styles.name}>
          {isMe ? "you" : first}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}: ${shortScore(entry)}`}
        onPress={onPress}
        {...longPress}
        style={styles.scoreCell}
      >
        <View style={styles.leader} />
        <Text style={[styles.score, entry.rank === 1 && styles.scoreFirst]} numberOfLines={1}>
          {shortScore(entry)}
        </Text>
        {entry.reactions.length > 0 ? (
          <Text style={styles.reactions} numberOfLines={1}>
            {entry.reactions.map((r) => r.emoji).join("")}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
    gap: tokens.space.xs,
  },
  cardDragging: { borderColor: tokens.neon.pink, backgroundColor: tokens.bg.elevated },
  pressed: { opacity: 0.7 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  titlePress: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 36,
  },
  icon: { width: ICON, height: ICON, backgroundColor: tokens.bg.elevated },
  iconFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  title: { flexShrink: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  streak: { flexDirection: "row", alignItems: "center", gap: 2 },
  streakText: {
    fontFamily: tokens.font.pixel,
    fontSize: 10,
    lineHeight: 16,
    color: tokens.neon.chartreuse,
  },
  menu: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, minHeight: 24 },
  metaLeft: { flex: 1, minWidth: 0 },
  turnout: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 14,
    letterSpacing: 1,
    color: tokens.text.secondary,
  },
  turnoutMuted: { color: tokens.text.secondary, opacity: 0.7 },
  placing: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  placingLabel: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 14,
    letterSpacing: 1,
    color: tokens.text.secondary,
  },
  placingRank: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
    color: tokens.text.primary,
  },
  placingWin: { color: tokens.neon.yellow },
  placingScore: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.text.primary,
  },
  pasteBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 28,
    justifyContent: "center",
  },
  pasteBtnPressed: { backgroundColor: tokens.accent.muted },
  pasteText: {
    fontFamily: tokens.font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
    color: tokens.neon.pink,
  },
  rows: { gap: 2, paddingTop: tokens.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 28,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
  },
  rowMe: { backgroundColor: tokens.accent.muted },
  rank: {
    width: 18,
    textAlign: "right",
    fontFamily: tokens.font.pixel,
    fontSize: 9,
    lineHeight: 14,
    color: tokens.text.secondary,
  },
  rankFirst: { color: tokens.neon.yellow },
  player: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, maxWidth: "48%" },
  name: { flexShrink: 1, color: tokens.text.primary },
  scoreCell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  leader: {
    flex: 1,
    height: 0,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
    borderStyle: "dotted",
    opacity: 0.8,
  },
  score: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.text.primary,
    flexShrink: 0,
  },
  scoreFirst: { color: tokens.neon.yellow },
  reactions: { fontSize: 11, lineHeight: 16, flexShrink: 0 },
  pinnedRule: {
    height: 0,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
    marginVertical: 2,
  },
  more: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 14,
    letterSpacing: 1,
    color: tokens.neon.pinkTint,
    paddingLeft: 26,
    paddingTop: 2,
  },
  skeleton: { gap: tokens.space.sm, paddingTop: tokens.space.xs },
  skeletonBar: { height: 10, backgroundColor: tokens.bg.elevated },
});
