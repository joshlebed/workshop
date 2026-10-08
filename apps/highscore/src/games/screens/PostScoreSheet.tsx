// Home's "Paste a score" sheet — the primary action on the Games home. The
// user usually arrives with a share text on the clipboard and no game in
// mind, so the host pre-fills the draft from the clipboard (read inside the
// tap) and `PostScoreForm` lets the classifier name the game. After a post
// lands the sheet turns into a "Next up" card for the first unplayed game, so
// one contextless paste rolls into the rest of the day's loop.

import type { MyGame } from "@workshop/shared/games";
import { Button, Sheet, Text, tokens } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";
import { type PostedScore, PostScoreForm } from "./PostScoreForm";

interface PostScoreSheetProps {
  visible: boolean;
  /** Clipboard text read in the opening tap; empty opens a focused blank box. */
  initialDraft: string;
  /** Today-pinned My Games, for "Next up". */
  games: MyGame[];
  onClose: () => void;
  /**
   * Fires after the exit animation. The host chains the follow-up — opening
   * the game picked in "Next up", or the add-game sheet — here, never while
   * this modal is still dismissing (two stacked Modals wedge iOS).
   */
  onClosed: () => void;
  /** "Different game? Add it by link" — host closes this sheet, then opens add. */
  onRequestAddGame: () => void;
  /** "Next up" → Play — host arms return-to-paste and opens the game. */
  onPlayNext: (game: MyGame) => void;
}

export function PostScoreSheet({
  visible,
  initialDraft,
  games,
  onClose,
  onClosed,
  onRequestAddGame,
  onPlayNext,
}: PostScoreSheetProps) {
  const [posted, setPosted] = useState<PostedScore | null>(null);
  // A fresh form per opening: the draft must not survive a close.
  const [session, setSession] = useState(0);
  useEffect(() => {
    if (visible) {
      setPosted(null);
      setSession((n) => n + 1);
    }
  }, [visible]);

  const { height } = useWindowDimensions();
  const formMaxHeight = Math.max(320, Math.round(height * 0.62));

  // First unplayed game in My Games order, skipping the one just posted (the
  // cache may not have caught up yet).
  const nextUp = useMemo(
    () => games.find((g) => !g.standings.viewerHasPlayed && g.gameId !== posted?.gameId) ?? null,
    [games, posted?.gameId],
  );

  return (
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      onClosed={onClosed}
      contentStyle={styles.sheet}
      testID="post-score-sheet"
    >
      {posted ? (
        <View style={styles.done} testID="post-score-done">
          <Text variant="heading">Posted to {posted.title}</Text>
          {nextUp ? (
            <View style={styles.nextCard} testID="post-score-next-up">
              <Text variant="caption" tone="muted" style={styles.nextLabel}>
                Next up
              </Text>
              <View style={styles.nextRow}>
                {nextUp.game.iconUrl ? (
                  <Image
                    source={{ uri: nextUp.game.iconUrl }}
                    style={styles.nextThumb}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.nextThumb, styles.nextThumbPlaceholder]}>
                    <Text style={styles.nextThumbGlyph}>🎮</Text>
                  </View>
                )}
                <View style={styles.nextBody}>
                  <Text variant="label" numberOfLines={1}>
                    {nextUp.game.title}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    Not played yet today
                  </Text>
                </View>
                <Button
                  label="Play"
                  size="md"
                  onPress={() => onPlayNext(nextUp)}
                  testID="post-score-next-play"
                />
              </View>
            </View>
          ) : (
            <Text tone="secondary">That's every game for today. Nice.</Text>
          )}
          <Button label="Done" variant="ghost" onPress={onClose} testID="post-score-done-close" />
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <Text variant="heading">Paste a score</Text>
            <Text variant="caption" tone="muted">
              Paste any game's share text. We'll work out which game it is.
            </Text>
          </View>
          <PostScoreForm
            key={session}
            initialDraft={initialDraft}
            entrySource="paste"
            autoFocus={initialDraft.trim().length === 0}
            onPosted={setPosted}
            onRequestAddGame={onRequestAddGame}
            style={{ maxHeight: formMaxHeight }}
          />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The form carries its own horizontal padding; pull the sheet's in so the
  // cards line up with the handle.
  sheet: { paddingHorizontal: tokens.space.xs },
  header: { gap: 4, paddingHorizontal: tokens.space.lg },
  done: { gap: tokens.space.lg, paddingHorizontal: tokens.space.lg },
  nextCard: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.canvas,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  nextLabel: { letterSpacing: 0.4, textTransform: "uppercase" },
  nextRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  nextBody: { flex: 1, minWidth: 0, gap: 2 },
  nextThumb: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  nextThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  nextThumbGlyph: { fontSize: tokens.font.size.lg },
});
