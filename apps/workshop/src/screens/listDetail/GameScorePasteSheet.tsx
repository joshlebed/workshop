// Paste sheet for logging today's score from the leaderboard status page.
//
// Shown two ways (both driven by `useReturnToPaste`): automatically when you
// return to the page after tapping Play, and manually via a card's "or paste
// result" link. Mirrors the game-detail PasteSlot (monospace input, Enter
// submits on web) but as a bottom sheet so it can ride on top of the card list.
//
// Holds a snapshot of the target item so the sheet keeps rendering its content
// through the exit animation after the parent clears the target.
//
// Generic over the target shape (anything with a `title`) so both leaderboard
// surfaces reuse it: the Lists surface passes `Item`s, the Games tab passes
// catalog `Game`s.
//
// Two parser affordances on top of the plain textarea:
// - **Preview** (`spec` prop): as the user pastes, show what the server will
//   record ("Recording score: 7") — or that it can't read one — so a silent
//   parse failure is no longer silent.
// - **Teach** (`onTeach` prop): for games with no parser, tokenize the pasted
//   share into candidate scores and let the user tap theirs. A spec is
//   synthesized from that one example (`synthesizeScoreSpec`), the user
//   confirms the direction, and the caller stores it server-side before
//   posting — no regex, no code.

import type { GameScoreDirection } from "@workshop/shared/games";
import {
  type ScoreCandidate,
  type ScoreSpec,
  suggestScoreDirection,
  synthesizeScoreSpec,
  tokenizeScoreCandidates,
} from "@workshop/shared/scoreParsing";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { previewScore } from "../../lib/scoreSpecs";
import { Avatar, Button, Chip, Sheet, Text, tokens } from "../../ui/index";

/** A learned parser, ready for `PUT /v1/games/:id/score-spec`. */
export interface TaughtScoreSpec {
  spec: ScoreSpec;
  exampleRaw: string;
  expectedValue: number;
  scoreDirection: GameScoreDirection;
}

interface GameScorePasteSheetProps<T extends { title: string }> {
  /** Target game, or `null` when the sheet should be closed. */
  item: T | null;
  userName: string | null;
  userAvatarUrl?: string | null;
  pending: boolean;
  /**
   * Parser for the target game (registry or user-taught); null/undefined =
   * none known. Drives the score preview under the input.
   */
  spec?: ScoreSpec | null;
  /**
   * When set (and there's no `spec`), the sheet offers the tap-the-score
   * teach flow and calls this instead of `onSubmit` once the user confirms a
   * learned parser. The caller stores the spec, then posts the score.
   */
  onTeach?: (item: T, scoreRaw: string, taught: TaughtScoreSpec) => void;
  onSubmit: (item: T, scoreRaw: string) => void;
  onClose: () => void;
}

const MAX_CANDIDATES = 6;

export function GameScorePasteSheet<T extends { title: string }>({
  item,
  userName,
  userAvatarUrl,
  pending,
  spec,
  onTeach,
  onSubmit,
  onClose,
}: GameScorePasteSheetProps<T>) {
  const [snapshot, setSnapshot] = useState<T | null>(item);
  const [draft, setDraft] = useState("");
  const [chosen, setChosen] = useState<ScoreCandidate | null>(null);
  const [direction, setDirection] = useState<GameScoreDirection>("desc");

  useEffect(() => {
    if (item) {
      setSnapshot(item);
      setDraft("");
      setChosen(null);
    }
  }, [item]);

  const visible = !!item;
  const empty = draft.trim().length === 0;

  const preview = useMemo(
    () => (empty || !spec ? null : previewScore(draft, spec)),
    [draft, empty, spec],
  );

  // Teach mode only when the game has no parser and the caller can store one.
  const teachable = !spec && !!onTeach && !empty;
  const candidates = useMemo(
    () => (teachable ? tokenizeScoreCandidates(draft).slice(0, MAX_CANDIDATES) : []),
    [teachable, draft],
  );
  // A draft edit invalidates the previous tap (offsets moved) — see
  // `editDraft` on the TextInput.
  const taught = useMemo((): TaughtScoreSpec | null => {
    if (!chosen) return null;
    const synthesized = synthesizeScoreSpec(draft, chosen);
    if (!synthesized) return null;
    return {
      spec: synthesized,
      exampleRaw: draft,
      expectedValue: chosen.value,
      scoreDirection: direction,
    };
  }, [chosen, draft, direction]);

  const pickCandidate = (candidate: ScoreCandidate) => {
    setChosen(candidate);
    setDirection(suggestScoreDirection(candidate));
  };

  const editDraft = (text: string) => {
    setDraft(text);
    setChosen(null);
  };

  const submit = () => {
    if (!snapshot || empty || pending) return;
    if (taught && onTeach) onTeach(snapshot, draft.trim(), taught);
    else onSubmit(snapshot, draft.trim());
  };

  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional (Shift+Enter still inserts one). RN-Web's
  // TextInput overwrites any custom onKeyDown with its own handler, which only
  // routes Enter to onSubmitEditing when blurOnSubmit is set on a multiline.
  const webProps =
    Platform.OS === "web"
      ? {
          blurOnSubmit: true,
          onSubmitEditing: submit,
        }
      : {};

  return (
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      onClosed={() => setSnapshot(null)}
      testID="game-paste-sheet"
    >
      {snapshot ? (
        <>
          <View style={styles.header}>
            <Avatar name={userName} imageUrl={userAvatarUrl} size="md" />
            <View style={styles.headerText}>
              <Text variant="heading" numberOfLines={1}>
                Played {snapshot.title}?
              </Text>
              <Text variant="caption" tone="muted">
                Paste your result to log today's score.
              </Text>
            </View>
          </View>
          <TextInput
            testID="game-paste-input"
            value={draft}
            onChangeText={editDraft}
            placeholder={"Paste your result here"}
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={2000}
            autoFocus
            style={styles.input}
            {...webProps}
          />
          {preview ? (
            <Text variant="caption" tone="muted" testID="game-paste-preview">
              {preview.value !== null
                ? `Recording score: ${preview.value}`
                : "Couldn't read a score in this — it'll post as “Played”."}
            </Text>
          ) : null}
          {teachable && candidates.length > 0 ? (
            <View style={styles.teach} testID="game-paste-teach">
              <Text variant="caption" tone="muted">
                {chosen
                  ? taught
                    ? `Got it — we'll record ${taught.expectedValue} and score this game the same way from now on.`
                    : "Couldn't learn that one — this post will keep the raw text."
                  : "New game! Tap your score so we can rank it:"}
              </Text>
              <View style={styles.chips}>
                {candidates.map((c) => (
                  <Chip
                    key={`${c.kind}-${c.start}-${c.text}`}
                    label={c.label}
                    selected={chosen?.start === c.start && chosen?.kind === c.kind}
                    onPress={() => pickCandidate(c)}
                    testID={`game-paste-candidate-${c.kind}-${c.start}`}
                  />
                ))}
              </View>
              {taught ? (
                <View style={styles.chips}>
                  {(["asc", "desc"] as const).map((dir) => (
                    <Chip
                      key={dir}
                      label={dir === "asc" ? "Lower is better" : "Higher is better"}
                      selected={direction === dir}
                      onPress={() => setDirection(dir)}
                      testID={`game-paste-direction-${dir}`}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button label="Cancel" variant="ghost" onPress={onClose} disabled={pending} />
            <Button
              label="Post score"
              onPress={submit}
              disabled={empty || pending}
              loading={pending}
              testID="game-paste-submit"
            />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: tokens.font.size.sm + 6,
  },
  teach: { gap: tokens.space.sm },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
