// One game in TODAY: your to-do and the day's standings in a single row.
//
// The first version of this screen had a checklist of unplayed games and then,
// underneath, a list of the same games' standings — the same title twice in one
// viewport. This is the merge: every game you follow appears once, in your
// order, with a box that says whether you've posted, and whatever has been
// posted today underneath it.
//
// The first game you still owe is rendered large with a lit PLAY button; every
// game after it is a 40px line. That is what keeps the glow rule honest (one
// primary button on screen, not nine) and stops the list reading as a stack of
// identical cards.

import type { MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { Pressable, StyleSheet, View } from "react-native";
import { glow, PixelIcon, Text, tokens } from "../theme";
import { GameGlyph, type LedgerRow, StandingsColumn } from "./GameLedger";

export interface TodayGameProps {
  game: MyGame;
  rows: LedgerRow[];
  selfId: string | null;
  /** The first game you still owe — rendered as the "next up" hero line. */
  featured: boolean;
  dragging?: boolean;
  onLongPressBody?: () => void;
  onPlay: () => void;
  onPaste: () => void;
  onOpen: () => void;
  onOpenReactionPicker: (userId: string) => void;
  onReact: (userId: string, emoji: string, currentlyReacted: boolean) => void;
}

export function TodayGame({
  game,
  rows,
  selfId,
  featured,
  dragging,
  onLongPressBody,
  onPlay,
  onPaste,
  onOpen,
  onOpenReactionPicker,
  onReact,
}: TodayGameProps) {
  const title = game.game.title;
  const played = game.standings.viewerHasPlayed;
  const streak = game.standings.viewerStreak ?? 0;
  const atRisk = !played && streak >= STREAK_MIN_DAYS;

  return (
    <View
      style={[styles.block, featured && styles.blockFeatured, dragging && styles.dragging]}
      testID={`today-game-${game.gameId}`}
    >
      <View style={[styles.header, featured && styles.headerFeatured]}>
        {played ? (
          <View style={styles.box} testID={`today-done-${game.gameId}`}>
            <PixelIcon name="checkbox-on" size={16} color={tokens.neon.chartreuse} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paste your ${title} result`}
            onPress={onPaste}
            onLongPress={onLongPressBody}
            delayLongPress={250}
            hitSlop={10}
            testID={`todo-paste-${game.gameId}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.box,
              featured && styles.boxFeatured,
              (pressed || hovered) && styles.boxActive,
            ]}
          >
            <PixelIcon
              name="checkbox"
              size={featured ? 24 : 16}
              color={featured ? tokens.text.primary : tokens.text.secondary}
            />
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the ${title} board`}
          onPress={onOpen}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          testID={`today-open-${game.gameId}`}
          style={styles.titleTap}
        >
          <View style={styles.titleRow}>
            {featured ? null : <GameGlyph iconUrl={game.game.iconUrl} size={16} />}
            <Text variant={featured ? "display" : "title"} numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </View>
          {featured && atRisk ? (
            <Text
              variant="caption"
              tone="warning"
              numberOfLines={1}
              testID={`todo-streak-${game.gameId}`}
            >
              🔥 {streak} day streak at stake
            </Text>
          ) : null}
        </Pressable>

        {!featured && atRisk ? (
          <Text variant="score" tone="warning" testID={`todo-streak-${game.gameId}`}>
            🔥{streak}
          </Text>
        ) : null}

        {played ? null : featured ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${title}`}
            onPress={onPlay}
            onLongPress={onLongPressBody}
            delayLongPress={250}
            testID={`todo-play-${game.gameId}`}
            style={({ pressed }) => [styles.playButton, pressed && styles.boxActive]}
          >
            <Text variant="heading" tone="link">
              Play
            </Text>
            <PixelIcon name="play" size={16} color={tokens.neon.pink} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${title}`}
            onPress={onPlay}
            onLongPress={onLongPressBody}
            delayLongPress={250}
            hitSlop={8}
            testID={`todo-play-${game.gameId}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.playLink,
              (pressed || hovered) && styles.boxActive,
            ]}
          >
            <Text variant="eyebrow" tone="link">
              Play
            </Text>
          </Pressable>
        )}
      </View>

      <StandingsColumn
        rows={rows}
        selfId={selfId}
        onOpenReactionPicker={onOpenReactionPicker}
        onReact={onReact}
        testIDPrefix="ledger-today"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.space.sm, paddingBottom: tokens.space.md },
  blockFeatured: { paddingBottom: tokens.space.lg },
  dragging: { opacity: 0.6, backgroundColor: tokens.bg.raised },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, minHeight: 40 },
  headerFeatured: { minHeight: 60, gap: tokens.space.md },
  box: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  boxFeatured: { width: 32, height: 32 },
  boxActive: { backgroundColor: tokens.bg.raised },
  titleTap: { flex: 1, minWidth: 0, gap: 3, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  title: { flexShrink: 1 },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    height: 40,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    ...glow(tokens.neon.pinkGlow),
  },
  playLink: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
});
