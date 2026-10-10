// One player on the box score (full leaderboard for one game, one day).
//
//   1  [av]  Josh                                  902
//            posted 2h ago · adjusted
//            100🎯 93🏆 89🎉 97🔥 80🌞               (the recap)
//            [🔥 2] [👏] [+]                         (reactions)
//
// The rank and the short score are pixel type; the recap is the server's
// summary in monospace. Your own row is pink-tinted and carries Edit / Clear /
// Fix instead of reactions.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { Game, GameStandingsEntry } from "@workshop/shared/games";
import { formatRelative } from "@workshop/ui";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Avatar, PixelIcon, Text, tokens } from "../../theme";
import { scoreLineLabel } from "../lib/scoreCheck";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { shortScore } from "../lib/shortScore";
import { ScoreReactions } from "./ScoreReactions";

export interface BoardRowProps {
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec" | "hasFormatter">;
  teachAvailable: boolean;
  isMe: boolean;
  onPressPlayer: (userId: string) => void;
  onEdit?: () => void;
  onClear?: () => void;
  onFix?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

export function BoardRow({
  entry,
  game,
  teachAvailable,
  isMe,
  onPressPlayer,
  onEdit,
  onClear,
  onFix,
  onReact,
  onOpenReactionPicker,
}: BoardRowProps) {
  const name = entry.displayName?.trim() || "Someone";
  const body = summarizeGameScoreBody(game, entry);
  const picked = scoreLineLabel(entry, game, teachAvailable);
  const [showOriginal, setShowOriginal] = useState(false);
  const canReact = !isMe && !!onOpenReactionPicker;
  const showReactions = entry.reactions.length > 0 || canReact;
  const first = entry.rank === 1;

  return (
    <View style={[styles.row, isMe && styles.rowMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.head}>
        <View style={styles.rankCell}>
          {first ? <PixelIcon name="crown" size={16} color={tokens.neon.yellow} /> : null}
          <Text style={[styles.rank, first && styles.rankFirst]}>{entry.rank ?? "·"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${name}'s profile`}
          onPress={() => onPressPlayer(entry.userId)}
          testID={`game-board-player-${entry.userId}`}
          style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
        >
          <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="md" />
          <View style={styles.nameWrap}>
            <Text variant="label" numberOfLines={1} style={styles.name}>
              {name}
              {isMe ? <Text style={styles.you}> · YOU</Text> : null}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {entry.updatedAt ? `posted ${formatRelative(entry.updatedAt)}` : " "}
              {picked ? ` · ${picked.toLowerCase()}` : ""}
            </Text>
          </View>
        </Pressable>
        <Text
          style={[styles.score, first && styles.scoreFirst]}
          testID={`game-board-score-${entry.userId}`}
        >
          {shortScore(entry)}
        </Text>
      </View>

      <View style={styles.detail}>
        <Text
          style={[styles.recap, !body && styles.recapMuted]}
          testID={`game-board-recap-${entry.userId}`}
        >
          {body ?? "Played"}
        </Text>
        {entry.adjusted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adjusted score. Show the original text"
            onPress={() => setShowOriginal((s) => !s)}
            hitSlop={6}
            testID={`game-board-adjusted-${entry.userId}`}
          >
            <Text variant="caption" tone="secondary" style={styles.adjusted}>
              adjusted — {showOriginal ? "hide" : "show"} original
            </Text>
          </Pressable>
        ) : null}
        {entry.adjusted && showOriginal ? (
          <Text style={[styles.recap, styles.recapMuted]}>{entry.scoreRaw}</Text>
        ) : null}

        {isMe && (onEdit || onClear || onFix) ? (
          <View style={styles.actions}>
            {onFix ? (
              <ActionLink label="FIX" onPress={onFix} testID="game-board-fix-score" />
            ) : null}
            {onEdit ? (
              <ActionLink label="EDIT" onPress={onEdit} testID="game-board-edit-score" />
            ) : null}
            {onClear ? (
              <ActionLink label="CLEAR" onPress={onClear} testID="game-board-clear-score" muted />
            ) : null}
          </View>
        ) : null}

        {showReactions ? (
          <View style={styles.reactions}>
            <ScoreReactions
              reactions={entry.reactions}
              testIDPrefix={`game-board-react-${entry.userId}`}
              {...(canReact && onReact
                ? { onToggle: (emoji, cur) => onReact(entry.userId, emoji, cur) }
                : {})}
              {...(canReact && onOpenReactionPicker
                ? { onAdd: () => onOpenReactionPicker(entry.userId) }
                : {})}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ActionLink({
  label,
  onPress,
  testID,
  muted,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  muted?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text style={[styles.actionText, muted && styles.actionTextMuted]}>{label}</Text>
    </Pressable>
  );
}

const RANK_W = 28;

const styles = StyleSheet.create({
  row: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.xs,
  },
  rowMe: { backgroundColor: tokens.accent.muted },
  pressed: { opacity: 0.7 },
  head: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rankCell: { width: RANK_W, alignItems: "center", gap: 1 },
  rank: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.text.secondary,
  },
  rankFirst: { color: tokens.neon.yellow },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { color: tokens.text.primary, fontSize: tokens.font.size.md },
  you: { fontFamily: tokens.font.pixel, fontSize: 8, color: tokens.neon.pinkTint },
  score: {
    fontFamily: tokens.font.pixel,
    fontSize: 16,
    lineHeight: 24,
    color: tokens.text.primary,
    flexShrink: 0,
  },
  scoreFirst: { color: tokens.neon.yellow },
  detail: { paddingLeft: RANK_W + tokens.space.sm, gap: tokens.space.xs },
  recap: {
    color: tokens.text.secondary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
  },
  recapMuted: { fontStyle: "italic", opacity: 0.8 },
  adjusted: { textDecorationLine: "underline" },
  actions: { flexDirection: "row", gap: tokens.space.lg, paddingTop: 2 },
  action: { paddingVertical: 2 },
  actionText: {
    fontFamily: tokens.font.pixel,
    fontSize: 9,
    lineHeight: 14,
    letterSpacing: 1,
    color: tokens.neon.pink,
  },
  actionTextMuted: { color: tokens.text.secondary },
  reactions: { paddingTop: 2 },
});
