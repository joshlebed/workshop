// One game's standings for one day, rendered as a ledger block in the feed.
//
// Not a card: no fill, no frame, no drop shadow. The block is a header line
// (the game's favicon + its name, which is the tap target that opens the board
// sheet) and a short column of ranked score lines under it. Elevation comes
// from the spine on the left, not from a box — a feed of twenty of these has to
// read as one continuous ledger, not twenty stacked cards.
//
// Each score line is `rank · name · glyph strip · value`. The value is the only
// thing set in the pixel face, right-aligned in a fixed column, so scanning a
// day is scanning one column of numbers. Tied ranks print once and blank
// underneath — three identical "1"s in a column reads as a bug.

import type { ScoreReactionSummary } from "@workshop/shared/games";
import { memo } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { ScoreReactions } from "../games/components/ScoreReactions";
import { PixelIcon, Text, tokens } from "../theme";
import type { ScoreDisplay } from "./scoreDisplay";

const TOP_N = 5;
const RANK_W = 16;
const VALUE_W = 62;

export interface LedgerRow {
  userId: string;
  displayName: string | null;
  /** Standard competition rank (1, 2, 2, 4); null when no numeric score. */
  rank: number | null;
  score: ScoreDisplay;
  reactions: ScoreReactionSummary[];
}

export interface GameLedgerProps {
  gameId: string;
  title: string;
  iconUrl: string | null;
  rows: LedgerRow[];
  selfId: string | null;
  onOpen: () => void;
  /** Tapping a friend's line reacts to it — the app's one social gesture. */
  onOpenReactionPicker?: (userId: string) => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  testIDPrefix?: string;
}

export const GameLedger = memo(function GameLedger({
  gameId,
  title,
  iconUrl,
  rows,
  selfId,
  onOpen,
  onOpenReactionPicker,
  onReact,
  testIDPrefix = "ledger",
}: GameLedgerProps) {
  return (
    <View style={styles.block} testID={`${testIDPrefix}-${gameId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the ${title} board`}
        onPress={onOpen}
        testID={`${testIDPrefix}-open-${gameId}`}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.header,
          (pressed || hovered) && styles.headerActive,
        ]}
      >
        <GameGlyph iconUrl={iconUrl} />
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </Pressable>
      <StandingsColumn
        rows={rows}
        selfId={selfId}
        onOpenReactionPicker={onOpenReactionPicker}
        onReact={onReact}
        testIDPrefix={testIDPrefix}
      />
    </View>
  );
});

/** The ranked score lines for one game/day — shared by the feed and TODAY. */
export function StandingsColumn({
  rows,
  selfId,
  onOpenReactionPicker,
  onReact,
  testIDPrefix,
}: {
  rows: LedgerRow[];
  selfId: string | null;
  onOpenReactionPicker?: (userId: string) => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  testIDPrefix: string;
}) {
  if (rows.length === 0) return null;
  const top = rows.slice(0, TOP_N);
  const selfInTop = selfId ? top.some((r) => r.userId === selfId) : false;
  const pinnedSelf = !selfInTop && selfId ? rows.find((r) => r.userId === selfId) : undefined;

  return (
    <View style={styles.rows}>
      {top.map((row, index) => (
        <ScoreLine
          key={row.userId}
          row={row}
          repeatRank={index > 0 && top[index - 1]?.rank === row.rank}
          isMe={row.userId === selfId}
          onOpenReactionPicker={onOpenReactionPicker}
          onReact={onReact}
          testIDPrefix={testIDPrefix}
        />
      ))}
      {pinnedSelf ? (
        <ScoreLine
          row={pinnedSelf}
          repeatRank={false}
          isMe
          onOpenReactionPicker={onOpenReactionPicker}
          onReact={onReact}
          testIDPrefix={testIDPrefix}
        />
      ) : null}
    </View>
  );
}

export function GameGlyph({ iconUrl, size = 18 }: { iconUrl: string | null; size?: number }) {
  if (iconUrl) {
    return (
      <Image
        source={{ uri: iconUrl }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
    </View>
  );
}

interface ScoreLineProps {
  row: LedgerRow;
  /** Same rank as the line above — print it once, not three times. */
  repeatRank: boolean;
  isMe: boolean;
  onOpenReactionPicker?: (userId: string) => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  testIDPrefix: string;
}

function ScoreLine({
  row,
  repeatRank,
  isMe,
  onOpenReactionPicker,
  onReact,
  testIDPrefix,
}: ScoreLineProps) {
  // First name only: these are your friends, and a truncated "Martin A…"
  // column is worse than a short one.
  const name = (row.displayName?.trim() || "Someone").split(/\s+/)[0] ?? "Someone";
  // You react to friends' scores, never your own. There is no separate "+"
  // button: the line IS the reaction target, which removes a column of
  // identical glyphs from the right edge of every game in the feed.
  const canReact = !isMe && !!onOpenReactionPicker;

  const line = (
    <>
      <Text
        variant="score"
        tone={row.rank === 1 ? "spotlight" : "secondary"}
        style={styles.rank}
        numberOfLines={1}
      >
        {repeatRank ? "" : (row.rank ?? "–")}
      </Text>
      <Text variant="label" numberOfLines={1} style={styles.name}>
        {isMe ? "You" : name}
      </Text>
      <View style={styles.stripWrap}>
        {row.score.strip ? (
          <Text variant="mono" tone="secondary" numberOfLines={1} style={styles.strip}>
            {row.score.strip}
          </Text>
        ) : null}
      </View>
      <Text
        variant="score"
        numberOfLines={1}
        style={styles.value}
        testID={`${testIDPrefix}-score-${row.userId}`}
      >
        {row.score.value ?? "·"}
      </Text>
    </>
  );

  return (
    <View style={styles.lineWrap} testID={`${testIDPrefix}-row-${row.userId}`}>
      {canReact ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`React to ${name}'s score`}
          onPress={() => onOpenReactionPicker?.(row.userId)}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.line,
            (pressed || hovered) && styles.lineActive,
          ]}
        >
          {line}
        </Pressable>
      ) : (
        <View style={[styles.line, isMe && styles.lineMe]}>{line}</View>
      )}
      {row.reactions.length > 0 ? (
        <View style={styles.reactions}>
          <ScoreReactions
            reactions={row.reactions}
            testIDPrefix={`${testIDPrefix}-react-${row.userId}`}
            {...(canReact && onReact
              ? { onToggle: (emoji: string, cur: boolean) => onReact(row.userId, emoji, cur) }
              : {})}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.space.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    marginLeft: -tokens.space.xs,
    paddingLeft: tokens.space.xs,
  },
  headerActive: { backgroundColor: tokens.bg.surface },
  title: { flex: 1, minWidth: 0 },
  rows: { gap: tokens.space.hair },
  lineWrap: { gap: 2 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 24,
    paddingLeft: tokens.space.sm,
    borderLeftWidth: tokens.bezel,
    borderLeftColor: "transparent",
  },
  lineActive: { backgroundColor: tokens.bg.surface },
  // Your own line is the one with a lit edge — no "you" pill needed.
  lineMe: { borderLeftColor: tokens.neon.pink },
  rank: { width: RANK_W, textAlign: "right" },
  name: { width: 64, color: tokens.text.secondary },
  stripWrap: { flex: 1, minWidth: 0 },
  strip: { color: tokens.text.primary },
  value: { width: VALUE_W, textAlign: "right", color: tokens.text.primary },
  reactions: { paddingLeft: tokens.space.sm + RANK_W + tokens.space.sm },
});
