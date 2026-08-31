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
// - **Teach** (`onTeach` prop): for games with no parser — or, when
//   `canReteach` is set (admin re-teach), one that already parses — tokenize
//   the pasted share into candidate scores and let the user tap theirs. A spec
//   is synthesized from that one example (`synthesizeScoreSpec`), the user
//   confirms the direction, and the caller stores it server-side before
//   posting — no regex, no code. Once a score is learned, the sheet also
//   shows an editable recap preview: the share's lines with grid + score
//   lines pre-kept, each tappable to include/exclude. The selection is
//   synthesized into a SummarySpec (`@workshop/shared/summarySpec`) — the
//   taught equivalent of a registry `formatShareBody` — and stored alongside
//   the parser.

import type { GameScoreDirection } from "@workshop/shared/games";
import {
  type ScoreCandidate,
  type ScoreSpec,
  suggestScoreDirection,
  synthesizeScoreSpec,
  tokenizeScoreCandidates,
} from "@workshop/shared/scoreParsing";
import {
  type SummarySpec,
  suggestSummaryLineIndexes,
  summaryShareLines,
  synthesizeSummarySpec,
} from "@workshop/shared/summarySpec";
import { Avatar } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, bezel, Chip, colors, font, Sheet, space, Text } from "../../theme";
import { previewScore } from "../lib/scoreSpecs";

/** A learned parser (+ optional recap formatter), ready for `PUT /v1/games/:id/score-spec`. */
export interface TaughtScoreSpec {
  spec: ScoreSpec;
  exampleRaw: string;
  expectedValue: number;
  scoreDirection: GameScoreDirection;
  /** Null = no trim learned; recaps show the cleaned full text. */
  summarySpec: SummarySpec | null;
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
   * When set, the sheet can offer the tap-the-score teach flow and calls this
   * instead of `onSubmit` once the user confirms a learned parser. The caller
   * stores the spec, then posts the score. Offered automatically when there's
   * no `spec` (a game's first teach); see `canReteach` for re-teaching one.
   */
  onTeach?: (item: T, scoreRaw: string, taught: TaughtScoreSpec) => void;
  /**
   * Allow the teach flow even when a `spec` already exists — i.e. re-teach an
   * already-parsed game. Admin-only on the Games surface (the backend gates
   * the matching `PUT …/score-spec` the same way); leave false/undefined for
   * the default "first teach only" behavior.
   */
  canReteach?: boolean;
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
  canReteach,
  onSubmit,
  onClose,
}: GameScorePasteSheetProps<T>) {
  const [snapshot, setSnapshot] = useState<T | null>(item);
  const [draft, setDraft] = useState("");
  const [chosen, setChosen] = useState<ScoreCandidate | null>(null);
  const [direction, setDirection] = useState<GameScoreDirection>("desc");
  // The user's include/exclude taps on recap-preview lines, keyed by raw line
  // index, layered over the suggested default. Reset whenever the underlying
  // lines can shift (draft edit, different candidate).
  const [lineOverrides, setLineOverrides] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (item) {
      setSnapshot(item);
      setDraft("");
      setChosen(null);
      setLineOverrides({});
    }
  }, [item]);

  const visible = !!item;
  const empty = draft.trim().length === 0;

  // Teach mode: a game with no parser (first teach — open to everyone) OR an
  // admin re-teaching an existing one (`canReteach`). The caller must also be
  // able to store the result (`onTeach`).
  const teachable = (!spec || !!canReteach) && !!onTeach && !empty;
  const candidates = useMemo(
    () => (teachable ? tokenizeScoreCandidates(draft).slice(0, MAX_CANDIDATES) : []),
    [teachable, draft],
  );
  const showTeach = teachable && candidates.length > 0;
  // True when the chips are re-teaching a game that already parses — used to
  // swap the "New game!" copy and to drop the live preview below.
  const reteaching = showTeach && !!spec;

  // Skip the live "Recording score: N" preview while the teach chips are up:
  // the old spec's read would fight the score you're tapping to (re)learn.
  const preview = useMemo(
    () => (empty || !spec || showTeach ? null : previewScore(draft, spec)),
    [draft, empty, spec, showTeach],
  );
  // A draft edit invalidates the previous tap (offsets moved) — see
  // `editDraft` on the TextInput.
  const learnedSpec = useMemo(
    () => (chosen ? synthesizeScoreSpec(draft, chosen) : null),
    [chosen, draft],
  );

  // Recap-preview state: the share's displayable lines, the suggested keep
  // set (grids + the tapped score's line), and the user's selection on top.
  const summaryLines = useMemo(
    () => (learnedSpec ? summaryShareLines(draft) : []),
    [learnedSpec, draft],
  );
  const suggestedLines = useMemo(
    () => new Set(learnedSpec && chosen ? suggestSummaryLineIndexes(draft, chosen.start) : []),
    [learnedSpec, chosen, draft],
  );
  const selectedLines = useMemo(() => {
    const picked = new Set<number>();
    for (const line of summaryLines) {
      if (lineOverrides[line.index] ?? suggestedLines.has(line.index)) picked.add(line.index);
    }
    return picked;
  }, [summaryLines, suggestedLines, lineOverrides]);
  // Null when the selection can't be learned (everything kept, nothing kept,
  // or no generalizable pattern) — the recap then shows the cleaned full text.
  const summarySpec = useMemo(
    () => (learnedSpec ? synthesizeSummarySpec(draft, [...selectedLines]) : null),
    [learnedSpec, draft, selectedLines],
  );
  // Only offer trimming when there's something to trim, and reflect what the
  // recap will ACTUALLY show: with no learned trim, every line renders.
  const summaryEditable = summaryLines.length > 1;
  const allLinesSelected = selectedLines.size === summaryLines.length;
  const summaryTrimFailed = summaryEditable && !summarySpec && !allLinesSelected;

  const taught = useMemo((): TaughtScoreSpec | null => {
    if (!chosen || !learnedSpec) return null;
    return {
      spec: learnedSpec,
      exampleRaw: draft,
      expectedValue: chosen.value,
      scoreDirection: direction,
      summarySpec,
    };
  }, [chosen, learnedSpec, draft, direction, summarySpec]);

  const pickCandidate = (candidate: ScoreCandidate) => {
    setChosen(candidate);
    setDirection(suggestScoreDirection(candidate));
    setLineOverrides({});
  };

  const toggleLine = (index: number) => {
    const current = lineOverrides[index] ?? suggestedLines.has(index);
    setLineOverrides((prev) => ({ ...prev, [index]: !current }));
  };

  const editDraft = (text: string) => {
    setDraft(text);
    setChosen(null);
    setLineOverrides({});
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
            placeholderTextColor={colors.textSecondary}
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
                : "Couldn't read a score in this. It'll post as “Played”."}
            </Text>
          ) : null}
          {showTeach ? (
            <View style={styles.teach} testID="game-paste-teach">
              <Text variant="caption" tone="muted">
                {chosen
                  ? taught
                    ? `Got it. We'll record ${taught.expectedValue} and score this game the same way from now on.`
                    : "Couldn't learn that one. This post will keep the raw text."
                  : reteaching
                    ? "Tap the score to re-teach this game:"
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
              {taught && summaryEditable ? (
                <View style={styles.summary} testID="game-paste-summary">
                  <Text variant="caption" tone="muted">
                    Tap a line to leave it out of recaps:
                  </Text>
                  <View style={styles.summaryBox}>
                    {summaryLines.map((line) => {
                      // Reflect what will actually render: with no learned
                      // trim, the recap falls back to the full text.
                      const included = summarySpec ? selectedLines.has(line.index) : true;
                      return (
                        <Pressable
                          key={line.index}
                          onPress={() => toggleLine(line.index)}
                          hitSlop={4}
                          testID={`game-paste-summary-line-${line.index}`}
                        >
                          <Text
                            style={[styles.summaryLine, !included && styles.summaryLineExcluded]}
                            numberOfLines={1}
                          >
                            {line.text}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {summaryTrimFailed ? (
                    <Text variant="caption" tone="muted" testID="game-paste-summary-fallback">
                      Couldn't trim it that way. The full result will show.
                    </Text>
                  ) : null}
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
    gap: space.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  input: {
    minHeight: 120,
    borderWidth: bezel,
    borderColor: colors.border,
    borderRadius: 0,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: colors.textPrimary,
    fontSize: font.size.sm,
    backgroundColor: colors.bg,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: font.size.sm + 6,
  },
  teach: { gap: space.sm },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  summary: { gap: space.sm },
  summaryBox: {
    borderWidth: bezel,
    borderColor: colors.border,
    borderRadius: 0,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.bg,
    gap: 2,
  },
  summaryLine: {
    color: colors.textPrimary,
    fontSize: font.size.sm,
    lineHeight: font.size.sm + 6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  summaryLineExcluded: {
    color: colors.textSecondary,
    textDecorationLine: "line-through",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space.md,
  },
});
