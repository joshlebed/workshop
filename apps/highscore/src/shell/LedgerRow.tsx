// One line of the ledger, in one of three states.
//
//   row    64px — cover, title, who played, my result in the right rail
//   strip  30px — the same line squeezed to a spine while another game owns
//                 the screen; still tappable, so you switch games without
//                 ever collapsing back
//   board  64px header + the full game board underneath
//
// There is no push and no second screen: the same element grows. Everything
// that moves is a shared value, so the header, the cover and the board all
// resolve on one 140ms ease-out with a per-row stagger away from whichever
// row was tapped.
//
// The header is a run of *sibling* Pressables, never nested ones — on web a
// Pressable with `accessibilityRole="button"` renders as a real <button>, and
// nesting those is invalid DOM (see the repo CLAUDE.md).

import type { MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { memo, type ReactNode, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Avatar, PixelIcon, pixelType, tokens } from "../theme";
import { AnimatedText, Text } from "../theme/Text";

export type RowMode = "row" | "strip" | "board";

const ROW_H = 64;
const STRIP_H = 36;
const COVER = 40;
const STRIP_COVER = 24;
const COL_W = 56;
const META_H = 22;
const GUTTER = COVER + tokens.space.md;

const OPEN = { duration: 140, easing: Easing.out(Easing.quad) } as const;
const SQUEEZE = { duration: 92, easing: Easing.out(Easing.quad) } as const;
/** Board content powers on in three hard frames — arcade attract mode. */
const REVEAL = { duration: 140, easing: Easing.steps(3, true) } as const;

export interface LedgerFace {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  rank: number | null;
}

export interface LedgerRowProps {
  game: MyGame;
  mode: RowMode;
  /** Stagger applied to the squeeze, in ms — grows with distance from the tap. */
  stagger: number;
  /**
   * My result for the viewed day, short enough for the rail. Null when I
   * didn't play, or when the result is a share grid too long to fit — those
   * set `myPlayed` instead so the rail shows a lit square, never an ellipsis.
   */
  myScore: string | null;
  myPlayed: boolean;
  /** True when I'm leading the day — the one place chartreuse is earned. */
  myScoreIsBest: boolean;
  faces: LedgerFace[];
  /** The day's leading result, already distilled — the BEST column. */
  bestScore: string | null;
  /** Viewer's consecutive-day run for this game (today-pinned). */
  streak: number;
  /** Results only post to today, so past days show no post affordance. */
  viewingToday: boolean;
  host: string | null;
  isDragging: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  /** Cover tile: opens the game and arms the paste-on-return prompt. */
  onPlay: () => void;
  /** Rail slot: opens the paste sheet without leaving the ledger. */
  onPost: () => void;
  onLongPressBody?: () => void;
  /** Set briefly after this game's score posts — the rail value blinks. */
  celebrate?: boolean;
  /** Rendered only while expanded — the parent builds it lazily. */
  board: ReactNode;
}

export const LedgerRow = memo(function LedgerRow({
  game,
  mode,
  stagger,
  myScore,
  myPlayed,
  myScoreIsBest,
  faces,
  bestScore,
  streak,
  viewingToday,
  host,
  isDragging,
  onExpand,
  onCollapse,
  onPlay,
  onPost,
  onLongPressBody,
  celebrate = false,
  board,
}: LedgerRowProps) {
  const squeezed = mode === "strip";
  const open = mode === "board";

  const t = useSharedValue(squeezed ? 1 : 0);
  const openT = useSharedValue(open ? 1 : 0);
  // Geometry eases; the board's *content* powers on in three hard frames.
  const reveal = useSharedValue(open ? 1 : 0);
  const boardH = useSharedValue(0);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    t.value = withDelay(squeezed ? stagger : 0, withTiming(squeezed ? 1 : 0, SQUEEZE));
  }, [squeezed, stagger, t]);

  useEffect(() => {
    openT.value = withTiming(
      open ? 1 : 0,
      open ? OPEN : { duration: 100, easing: Easing.out(Easing.quad) },
    );
    reveal.value = withTiming(
      open ? 1 : 0,
      open ? REVEAL : { duration: 60, easing: Easing.linear },
    );
  }, [open, openT, reveal]);

  useEffect(() => {
    boardH.value = measured;
  }, [measured, boardH]);

  const headerStyle = useAnimatedStyle(() => ({
    height: ROW_H - (ROW_H - STRIP_H) * t.value,
  }));
  const coverStyle = useAnimatedStyle(() => {
    const size = COVER - (COVER - STRIP_COVER) * t.value;
    return { width: size, height: size };
  });
  // The meta line collapses its *height* as well as its opacity, or the
  // squeezed 30px spine clips the title it still has to show.
  const metaStyle = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    height: META_H * (1 - t.value),
  }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value * 0.2 }));
  const boardWrapStyle = useAnimatedStyle(() => ({
    height: boardH.value * openT.value,
  }));
  const boardInnerStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

  // Arcade attract-mode blink on a freshly posted score: three hard frames,
  // no easing, no springs (DESIGN.md's one sanctioned celebration).
  const blink = useSharedValue(1);
  useEffect(() => {
    if (!celebrate) return;
    blink.value = withRepeat(
      withTiming(0.15, { duration: 90, easing: Easing.steps(1, true) }),
      6,
      true,
    );
    return () => {
      blink.value = 1;
    };
  }, [celebrate, blink]);
  const railValueStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const title = game.game.title;
  const playable = viewingToday && !myPlayed;

  return (
    <View
      style={[styles.row, open && styles.rowOpen, isDragging && styles.rowDragging]}
      testID={`game-card-${game.gameId}`}
    >
      <Animated.View style={[styles.header, headerStyle]}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Play ${title}`}
          onPress={onPlay}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          hitSlop={4}
          testID={`game-card-cover-${game.gameId}`}
          style={({ pressed }) => [styles.coverPress, pressed && styles.dim]}
        >
          <Animated.View style={[styles.cover, coverStyle]}>
            {game.game.iconUrl ? (
              <Image
                source={{ uri: game.game.iconUrl }}
                style={styles.coverImage}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
            )}
          </Animated.View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? `Collapse ${title}` : `Open ${title}`}
          accessibilityState={{ expanded: open }}
          onPress={open ? onCollapse : onExpand}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          testID={`game-card-body-${game.gameId}`}
          style={styles.titleCol}
        >
          <Animated.View style={[styles.titleLine, titleStyle]}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {streak >= STREAK_MIN_DAYS ? (
              <View style={styles.streak}>
                <PixelIcon name="zap" size={16} color={tokens.neon.chartreuse} />
                <Text style={styles.streakCount}>{streak}</Text>
              </View>
            ) : null}
          </Animated.View>
          <Animated.View style={[styles.meta, metaStyle]} pointerEvents="none">
            {open ? (
              <Text numberOfLines={1} style={styles.host}>
                {host ?? "Daily game"}
              </Text>
            ) : faces.length > 0 ? (
              <Facepile faces={faces} />
            ) : (
              <Text style={styles.host}>{viewingToday ? "Nobody yet" : "No plays"}</Text>
            )}
          </Animated.View>
        </Pressable>

        <View style={styles.bestCol} pointerEvents="none">
          {!open && bestScore ? (
            <Text numberOfLines={1} style={styles.best}>
              {bestScore}
            </Text>
          ) : null}
        </View>

        <View style={styles.rail}>
          {open ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Collapse ${title}`}
              onPress={onCollapse}
              hitSlop={10}
              testID={`game-card-collapse-${game.gameId}`}
              style={({ pressed }) => [styles.collapse, pressed && styles.dim]}
            >
              <PixelIcon name="chevron-up" size={16} color={tokens.text.secondary} />
            </Pressable>
          ) : myScore ? (
            <AnimatedText
              numberOfLines={1}
              style={[styles.score, myScoreIsBest && styles.scoreBest, railValueStyle]}
              testID={`game-card-score-${game.gameId}`}
            >
              {myScore}
            </AnimatedText>
          ) : myPlayed ? (
            <View
              style={styles.playedMark}
              testID={`game-card-score-${game.gameId}`}
              accessibilityLabel="You played"
            />
          ) : playable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Post your ${title} result`}
              onPress={onPost}
              onLongPress={onLongPressBody}
              delayLongPress={250}
              hitSlop={8}
              testID={`game-card-play-${game.gameId}`}
              style={styles.postPress}
            >
              {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
                // An empty slot waiting for today's result. Quiet at rest —
                // seven lit marks down the column would shout — and it lights
                // pink under the finger.
                <View style={[styles.slot, (pressed || hovered) && styles.slotLit]} />
              )}
            </Pressable>
          ) : null}
        </View>
      </Animated.View>

      <Animated.View style={[styles.boardWrap, boardWrapStyle]}>
        <Animated.View
          style={boardInnerStyle}
          onLayout={(e) => setMeasured(e.nativeEvent.layout.height)}
        >
          {board}
        </Animated.View>
      </Animated.View>
    </View>
  );
});

/** Who played, in rank order. The count is the faces; there is no "N played". */
function Facepile({ faces }: { faces: LedgerFace[] }) {
  const shown = faces.slice(0, 5);
  return (
    <View style={styles.facepile}>
      {shown.map((face, i) => (
        <View key={face.userId} style={i > 0 ? styles.faceOverlap : undefined}>
          <Avatar name={face.displayName} imageUrl={face.avatarUrl} size="xs" />
        </View>
      ))}
      {faces.length > shown.length ? (
        <Text style={styles.faceMore}>+{faces.length - shown.length}</Text>
      ) : null}
    </View>
  );
}

export const ledgerMetrics = { ROW_H, STRIP_H, GUTTER, COL_W } as const;

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
    overflow: "hidden",
  },
  rowOpen: {
    backgroundColor: tokens.bg.surface,
    borderBottomWidth: tokens.bezel,
  },
  rowDragging: {
    backgroundColor: tokens.bg.elevated,
    borderBottomColor: tokens.neon.pink,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  coverPress: { width: GUTTER, alignItems: "flex-start", justifyContent: "center" },
  cover: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  coverImage: { width: "100%", height: "100%" },
  dim: { opacity: 0.6 },
  titleCol: { flex: 1, minWidth: 0, justifyContent: "center", gap: 3 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  title: { ...pixelType(11), color: tokens.text.primary, flexShrink: 1 },
  streak: { flexDirection: "row", alignItems: "center", gap: 2 },
  streakCount: { ...pixelType(10), color: tokens.neon.chartreuse },
  meta: { justifyContent: "center", overflow: "hidden" },
  host: { fontSize: 12, lineHeight: 16, color: tokens.text.secondary },
  facepile: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  faceOverlap: { marginLeft: -5 },
  faceMore: { fontSize: 11, lineHeight: 16, color: tokens.text.secondary, marginLeft: 6 },
  bestCol: { width: COL_W, alignItems: "flex-end", justifyContent: "center" },
  best: { ...pixelType(10), color: tokens.neon.yellow },
  rail: { width: COL_W, alignItems: "flex-end", justifyContent: "center" },
  score: { ...pixelType(12), color: tokens.text.primary, textAlign: "right" },
  scoreBest: { color: tokens.neon.chartreuse },
  slot: { width: 14, height: 14, borderWidth: tokens.bezel, borderColor: tokens.border.default },
  slotLit: { borderColor: tokens.neon.pink },
  playedMark: { width: 10, height: 10, backgroundColor: tokens.neon.chartreuse },
  postPress: { alignItems: "flex-end", justifyContent: "center" },
  collapse: { width: 32, height: 32, alignItems: "flex-end", justifyContent: "center" },
  boardWrap: { overflow: "hidden" },
});
