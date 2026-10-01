// One game on the home board.
//
// Not a card — a full-bleed ledger band. A fixed 42px rail on the left carries
// the game's mark and a 2px rule; everything else hangs off that rule, and the
// right edge stays ragged. Vertically the band is a hierarchy of exactly three
// things: what the game is, what *you* got, and what everyone else got.
//
// The band is the control surface:
//   swipe right → play (opens the game, arms the return-to-paste prompt)
//   swipe left  → paste (log or fix today's result)
//   tap         → the game's board
// Both swipes have a visible tap fallback. While you haven't posted, the slot
// where your score will land renders as a two-key control (PLAY / PASTE) — the
// affordance sits exactly where the result appears. Once you've posted, the
// hero numeral takes that slot and the fallbacks move to the board's dock.
//
// The drag is quantized to the 6px rhythm, so the band steps rather than
// glides, and it hard-detents at the action threshold with a haptic.

import type { GameStandings, GameStandingsEntry, MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { memo, useCallback, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { rememberRow } from "../../../nav/rowGeometry";
import { PixelIcon } from "../../../theme/PixelIcon";
import { Text } from "../../../theme/Text";
import { snapToRhythm, stepped, textGlow, tokens } from "../../../theme/tokens";
import { summarizeGameScoreBody } from "../../lib/scoresSummary";

const RAIL = 42;
const spotlightGlow = textGlow(tokens.neon.yellowGlow, 8);
/** How far the band can travel; the action fires past `THRESHOLD`. */
const MAX_REVEAL = 96;
const THRESHOLD = 66;
const CHIP_LIMIT = 4;

export interface GameRowProps {
  /** Today-pinned catalog row — title, url, streak. */
  game: MyGame;
  /** Standings for the day being viewed (may be a past day). */
  standings: GameStandings | undefined;
  selfId: string | null;
  /** Past days are read-only: no swipe, no slot control. */
  viewingToday: boolean;
  loading: boolean;
  onOpen: () => void;
  onPlay: () => void;
  onPaste: () => void;
  /** Tap a friend's chip to react to their score. */
  onReact: (userId: string, displayName: string | null) => void;
}

function firstLine(text: string | null): string | null {
  const line = text?.split("\n").find((l) => l.trim().length > 0);
  return line?.trim() ?? null;
}

function _ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][rank % 10];
  return `${rank}${suffix ?? "th"}`;
}

export const GameRow = memo(function GameRow({
  game,
  standings,
  selfId,
  viewingToday,
  loading,
  onOpen,
  onPlay,
  onPaste,
  onReact,
}: GameRowProps) {
  const containerRef = useRef<View>(null);
  const tx = useSharedValue(0);
  const armed = useSharedValue(0);

  const entries = (standings?.entries ?? []).filter(
    (e) => e.scoreRaw != null && e.scoreRaw.length > 0,
  );
  const mine = selfId ? entries.find((e) => e.userId === selfId) : undefined;
  const others = entries.filter((e) => e.userId !== selfId);
  const played = !!mine;
  const field = entries.length;
  const streak = game.standings.viewerStreak ?? 0;
  const swipeable = viewingToday && !loading;

  // measureInWindow is async, so the navigation rides in its callback — that
  // way the board always has a rect to unfold from, never a stale one.
  const open = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      onOpen();
      return;
    }
    node.measureInWindow((_x, y, _w, h) => {
      rememberRow(game.gameId, { pageY: y, height: h });
      onOpen();
    });
  }, [game.gameId, onOpen]);

  const detent = useCallback(() => haptics.selection(), []);

  const pan = Gesture.Pan()
    .enabled(swipeable)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const raw = Math.max(-MAX_REVEAL, Math.min(MAX_REVEAL, e.translationX));
      tx.value = snapToRhythm(raw);
      const past = Math.abs(tx.value) >= THRESHOLD ? 1 : 0;
      if (past !== armed.value) {
        armed.value = past;
        if (past === 1) runOnJS(detent)();
      }
    })
    .onEnd(() => {
      const fired = tx.value;
      armed.value = 0;
      tx.value = withTiming(0, { duration: tokens.motion.base, easing: stepped });
      if (fired >= THRESHOLD) runOnJS(onPlay)();
      else if (fired <= -THRESHOLD) runOnJS(onPaste)();
    });

  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const playUnderStyle = useAnimatedStyle(() => ({ opacity: tx.value > 0 ? 1 : 0 }));
  const pasteUnderStyle = useAnimatedStyle(() => ({ opacity: tx.value < 0 ? 1 : 0 }));

  const heroBody = firstLine(mine ? summarizeGameScoreBody(game.game, mine) : null);
  const hero = mine
    ? mine.scoreValue != null
      ? String(mine.scoreValue)
      : (heroBody ?? "—")
    : null;

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.under, styles.underPlay, playUnderStyle]}>
        <PixelIcon name="play" size={16} color={tokens.text.onAccent} />
        <Text variant="heading" style={styles.underPlayLabel}>
          Play
        </Text>
      </Animated.View>
      <Animated.View style={[styles.under, styles.underPaste, pasteUnderStyle]}>
        <Text variant="heading" style={styles.underPasteLabel}>
          Paste
        </Text>
        <PixelIcon name="clipboard" size={16} color={tokens.neon.pink} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.band, bandStyle]}>
          {/* The ledger rule runs the full height of the band, behind
              everything — the rail is a column, not a decoration on one row. */}
          <View style={styles.rule} />

          {/* Tap target for the board. Everything interactive *inside* it is
              plain text: react-native-web renders an `accessibilityRole="button"`
              View as a real <button>, so the slot keys and player names have to
              be siblings, not children (nested <button> is invalid DOM). */}
          <Pressable
            ref={containerRef}
            accessibilityRole="button"
            accessibilityLabel={`Open the ${game.game.title} board`}
            onPress={open}
            testID={`game-row-${game.gameId}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.press,
              (pressed || hovered) && styles.pressActive,
            ]}
          >
            {/* The rail is your standing, on home and on the board alike — one
                column that means one thing everywhere. */}
            <View style={styles.rail}>
              <Text
                variant="score"
                tone={mine?.rank === 1 ? "spotlight" : "secondary"}
                style={[styles.railRank, mine?.rank === 1 && spotlightGlow]}
              >
                {mine?.rank != null ? String(mine.rank) : "·"}
              </Text>
              {mine?.rank != null && field > 1 ? (
                <Text variant="data" tone="secondary" style={styles.railField}>
                  {`/${field}`}
                </Text>
              ) : null}
            </View>

            <View style={styles.body}>
              <Text variant="heading" numberOfLines={1} style={styles.title}>
                {game.game.title}
              </Text>

              {loading ? (
                <View style={styles.skeleton} />
              ) : played ? (
                <Text variant="score" numberOfLines={1} style={styles.hero}>
                  {hero}
                </Text>
              ) : !viewingToday ? (
                <Text variant="data" tone="secondary" style={styles.noEntry}>
                  NO ENTRY
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* The slot where the score will land is the control until it does.
              The streak rides here rather than on the title, so it only ever
              appears where it's a reason to act. */}
          {!loading && !played && viewingToday ? (
            <View style={styles.indent} testID={`game-row-slot-${game.gameId}`}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Play ${game.game.title}`}
                onPress={onPlay}
                testID={`game-row-play-${game.gameId}`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.slotKey,
                  styles.slotPlay,
                  (pressed || hovered) && styles.slotKeyActive,
                ]}
              >
                <Text variant="heading" style={styles.slotPlayLabel}>
                  Play
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Paste your ${game.game.title} result`}
                onPress={onPaste}
                testID={`game-row-paste-${game.gameId}`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.slotKey,
                  (pressed || hovered) && styles.slotKeyActive,
                ]}
              >
                <Text variant="heading" style={styles.slotPasteLabel}>
                  Paste
                </Text>
              </Pressable>
              {streak >= STREAK_MIN_DAYS ? (
                <Text variant="caption" tone="success" style={styles.streak}>
                  {`${streak}-day run`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {others.length > 0 ? (
            <View style={[styles.indent, styles.strip]}>
              {others.slice(0, CHIP_LIMIT).map((entry) => (
                <PlayerChip key={entry.userId} entry={entry} onPress={onReact} />
              ))}
              {others.length > CHIP_LIMIT ? (
                <Text variant="caption" tone="secondary">
                  {`+${others.length - CHIP_LIMIT}`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

/** One friend's standing: initial, score, and any reaction. No box. */
function PlayerChip({
  entry,
  onPress,
}: {
  entry: GameStandingsEntry;
  onPress: (userId: string, displayName: string | null) => void;
}) {
  const name = entry.displayName?.trim() || "Someone";
  const initial = name.slice(0, 1).toUpperCase();
  const value =
    entry.scoreValue != null
      ? String(entry.scoreValue)
      : (firstLine(entry.scoreRaw)?.slice(0, 4) ?? "·");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`React to ${name}’s score`}
      onPress={() => onPress(entry.userId, entry.displayName)}
      testID={`game-row-chip-${entry.userId}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.chip,
        (pressed || hovered) && styles.chipActive,
      ]}
    >
      <Text variant="score" tone="secondary" style={styles.chipInitial}>
        {initial}
      </Text>
      <Text
        variant="score"
        tone={entry.rank === 1 ? "spotlight" : "primary"}
        style={styles.chipValue}
      >
        {value}
      </Text>
      {entry.reactions.length > 0 ? (
        <Text style={styles.chipReaction}>{entry.reactions[0]?.emoji}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  under: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "none",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
  },
  underPlay: { backgroundColor: tokens.neon.pink, justifyContent: "flex-start" },
  underPlayLabel: { fontSize: 12, color: tokens.text.onAccent },
  underPaste: { backgroundColor: tokens.bg.raised, justifyContent: "flex-end" },
  underPasteLabel: { fontSize: 12, color: tokens.neon.pinkTint },
  band: { backgroundColor: tokens.bg.canvas, paddingBottom: tokens.space.md },
  rule: {
    position: "absolute",
    pointerEvents: "none",
    top: 0,
    bottom: 0,
    left: RAIL,
    width: tokens.bezel,
    backgroundColor: tokens.border.default,
  },
  press: { flexDirection: "row", paddingRight: tokens.space.lg, paddingTop: tokens.space.md },
  pressActive: { backgroundColor: tokens.bg.surface },
  rail: { width: RAIL, alignItems: "center", paddingTop: tokens.space.xs },
  railRank: { fontSize: 14, lineHeight: 18 },
  railField: { fontSize: 10, lineHeight: 14 },
  noEntry: { letterSpacing: 1 },
  body: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  title: { flexShrink: 1, fontSize: 12, color: tokens.text.primary },
  streak: { paddingLeft: tokens.space.sm },
  skeleton: { height: 24, width: "38%", backgroundColor: tokens.bg.surface },
  hero: { fontSize: 24, lineHeight: 30, color: tokens.text.primary },
  // Everything below the tap target hangs off the same rule.
  indent: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space.sm,
    paddingLeft: RAIL + tokens.space.md,
    paddingRight: tokens.space.lg,
    paddingTop: tokens.space.sm,
  },
  slotKey: {
    height: 30,
    paddingHorizontal: tokens.space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  slotPlay: { borderColor: tokens.neon.pink },
  slotKeyActive: { backgroundColor: tokens.bg.raised },
  slotPlayLabel: { fontSize: 11, color: tokens.neon.pink },
  slotPasteLabel: { fontSize: 11, color: tokens.text.secondary },
  strip: { gap: tokens.space.lg },
  chip: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  chipActive: { opacity: 0.6 },
  chipInitial: { fontSize: 10, lineHeight: 14 },
  chipValue: { fontSize: 12, lineHeight: 16 },
  chipReaction: { fontSize: 12, lineHeight: 16 },
});
