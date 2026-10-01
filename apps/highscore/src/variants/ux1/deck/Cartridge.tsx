// One game, full screen. There is no separate game-board route: the cartridge
// *is* the board. Today sits at the top with the play slot; scrolling down
// pulls yesterday and then earlier days into view, fetching each day's
// leaderboard the first time it's reached.

import type { MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { openExternalUrl } from "@workshop/ui";
import { memo, useCallback, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { shiftDateKey } from "../games/lib/gameDate";
import { deck, GutterRow, PixelIcon, Text, tokens } from "../theme";
import { CartridgeLabel } from "./CartridgeLabel";
import { DayBlock, PlayControl } from "./DayBlock";

/** Days rendered before scrolling reveals more, and how many each pull adds. */
const INITIAL_DAYS = 2;
const DAYS_PER_PULL = 2;
/** Distance from the bottom that pulls the next days in. */
const PULL_MARGIN = 240;

interface CartridgeProps {
  myGame: MyGame;
  mark: string | undefined;
  todayKey: string;
  width: number;
  /** Only the cartridge under the finger fetches history. */
  active: boolean;
  onPlay: () => void;
  onPaste: (draft?: string) => void;
  onRemove: () => void;
}

export const Cartridge = memo(function Cartridge({
  myGame,
  mark,
  todayKey,
  width,
  active,
  onPlay,
  onPaste,
  onRemove,
}: CartridgeProps) {
  const [daysShown, setDaysShown] = useState(INITIAL_DAYS);
  const viewportHeight = useRef(0);
  const game = myGame.game;
  const streak = myGame.standings.viewerStreak;
  const playedToday = myGame.standings.viewerHasPlayed;

  const grow = useCallback(() => {
    setDaysShown((d) => Math.min(d + DAYS_PER_PULL, deck.daysDeep));
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      if (contentSize.height - contentOffset.y - layoutMeasurement.height < PULL_MARGIN) grow();
    },
    [grow],
  );

  // A game with few players doesn't fill the screen, so scrolling can never
  // pull the next days in. Keep growing until the column is long enough to
  // scroll — the deck should never bottom out into empty canvas.
  const onContentSize = useCallback(
    (_w: number, h: number) => {
      if (viewportHeight.current > 0 && h < viewportHeight.current + PULL_MARGIN) grow();
    },
    [grow],
  );

  const days: string[] = [];
  for (let i = 0; i < daysShown; i++) days.push(shiftDateKey(todayKey, -i));

  return (
    <View style={[styles.root, { width }]} testID={`cartridge-${game.id}`}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        onContentSizeChange={onContentSize}
        stickyHeaderIndices={[0]}
        onLayout={(e) => {
          viewportHeight.current = e.nativeEvent.layout.height;
        }}
        scrollEventThrottle={64}
      >
        <GutterRow
          rule
          marker={<CartridgeLabel title={game.title} mark={mark} size={28} active />}
          style={styles.header}
        >
          <View style={styles.headerRow}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${game.title}`}
              accessibilityHint="Opens the game in your browser"
              onPress={() => openExternalUrl(game.url)}
              testID="cartridge-title"
              style={({ pressed }) => [styles.titleRow, pressed && styles.titlePressed]}
            >
              <Text variant="title" numberOfLines={1} style={styles.title}>
                {game.title}
              </Text>
              {streak >= STREAK_MIN_DAYS ? (
                <View style={styles.streak} testID="cartridge-streak">
                  <PixelIcon name="zap" size={16} color={tokens.neon.chartreuse} />
                  <Text variant="score" tone="success" style={styles.streakText}>
                    {streak}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            {/* The cartridge's controls belong on the cartridge, and the
                header is sticky — so today's board starts at rank 1 instead
                of behind a button. */}
            {playedToday ? (
              <PixelIcon name="external-link" size={16} color={tokens.text.secondary} />
            ) : (
              <PlayControl gameId={game.id} onPlay={onPlay} onPaste={() => onPaste()} />
            )}
          </View>
        </GutterRow>

        {days.map((dayKey, i) => (
          <DayBlock
            key={dayKey}
            game={game}
            dayKey={dayKey}
            todayKey={todayKey}
            {...(dayKey === todayKey ? { todayEntries: myGame.standings.entries } : {})}
            enabled={active && i < daysShown}
            onPaste={onPaste}
          />
        ))}

        {daysShown >= deck.daysDeep ? (
          <View style={styles.end}>
            <Text variant="caption" tone="muted">
              {`${deck.daysDeep} days back — that's the tape.`}
            </Text>
            {/* Ejecting is the end of the cartridge, not a button competing
                with the title. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Eject ${game.title} from your deck`}
              onPress={onRemove}
              hitSlop={8}
              testID="cartridge-remove"
              style={({ pressed }) => [pressed && styles.ejectPressed]}
            >
              <Text variant="caption" style={styles.ejectLabel}>
                {`Eject ${game.title}`}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: tokens.space.xxl * 2 },
  header: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.md,
    // Sticky: it sits over the day blocks, so it needs the canvas under it
    // and a seam of its own.
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md, minHeight: 28 },
  titleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  titlePressed: { opacity: 0.7 },
  title: { flexShrink: 1, fontSize: 14, lineHeight: 22 },
  streak: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  streakText: { fontSize: 11, lineHeight: 16 },
  end: {
    paddingTop: tokens.space.lg,
    paddingLeft: deck.gutter + tokens.space.md,
    paddingRight: tokens.space.lg,
    gap: tokens.space.md,
    alignItems: "flex-start",
  },
  ejectPressed: { opacity: 0.6 },
  ejectLabel: { color: tokens.text.secondary, textDecorationLine: "underline" },
});
