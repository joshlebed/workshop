import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/apiError";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Button, Sheet, Text, tokens, useToast } from "../../theme";
import { applyScorePick } from "../api/teach";
import { askScoreDirection } from "../lib/askScoreDirection";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { useScoreCheck } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { ScoreCheckPanel } from "./ScoreCheckPanel";

/** The viewer's own posted score, as "Fix score" needs it. */
export interface FixScoreTarget {
  gameId: string;
  gameTitle: string;
  periodKey: string;
  scoreRaw: string;
}

/**
 * "Fix score" on the poster's own row: pick which candidate in the posted
 * text is the score, or "I didn't finish". The text and the day stay as
 * posted. The pick fixes this score at once; when it can also teach the game,
 * that happens after the sheet has closed.
 */
export function FixScoreSheet({
  target,
  today,
  onClose,
}: {
  target: FixScoreTarget | null;
  today: string;
  onClose: () => void;
}) {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // Keeps the content rendered through the exit animation.
  const [snapshot, setSnapshot] = useState<FixScoreTarget | null>(target);
  useEffect(() => {
    if (target) setSnapshot(target);
  }, [target]);

  const check = useScoreCheck({
    gameId: target ? target.gameId : null,
    text: target?.scoreRaw ?? "",
    periodKey: target?.periodKey ?? today,
    entry: "fix",
    today,
    fixing: true,
  });

  const fix = useMutation({
    mutationFn: async (fixing: FixScoreTarget) => {
      const extras = check.extras();
      const { pick, overrodeRole } = extras.body;
      if (!pick) throw new Error("Pick your score first");
      const applied = await applyScorePick(
        fixing.gameId,
        fixing.periodKey,
        { pick, ...(overrodeRole ? { overrodeRole } : {}) },
        token,
      );
      return { applied, extras, fixing };
    },
    onSuccess: async ({ applied, extras, fixing }) => {
      onClose();
      // The cached preview of this text says what the parser made of it and
      // whether the game had one — both may just have changed.
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ["games"] }),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      await refresh();
      showToast({ message: "Score fixed", tone: "success" });
      const taught = await teachAfterPost({
        gameId: fixing.gameId,
        periodKey: fixing.periodKey,
        hint: applied.teach,
        scoreDirection: extras.scoreDirection,
        askDirection: askScoreDirection(fixing.gameTitle),
        token,
      });
      const message = teachOutcomeMessage(taught, fixing.gameTitle);
      if (taught) await refresh();
      if (message) showToast({ message, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't fix score"), tone: "danger" });
    },
  });

  const canSave = !!check.pick && !check.mismatch && !fix.isPending;
  return (
    <Sheet
      visible={!!target}
      onRequestClose={onClose}
      onClosed={() => setSnapshot(null)}
      testID="fix-score-sheet"
    >
      {snapshot ? (
        <>
          <View style={styles.header}>
            <Text variant="heading" numberOfLines={1}>
              Fix your {snapshot.gameTitle} score
            </Text>
            <Text variant="caption" tone="muted">
              Your result stays as you posted it. Pick what counts as the score.
            </Text>
          </View>
          <View style={styles.rawBox}>
            <Text style={styles.raw} testID="fix-score-raw">
              {snapshot.scoreRaw}
            </Text>
          </View>
          <ScoreCheckPanel check={check} testID="fix-score-check" />
          <View style={styles.actions}>
            <Button label="Cancel" variant="ghost" onPress={onClose} disabled={fix.isPending} />
            <Button
              label="Save"
              onPress={() => fix.mutate(snapshot)}
              disabled={!canSave}
              loading={fix.isPending}
              testID="fix-score-save"
            />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  rawBox: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    maxHeight: 180,
    overflow: "hidden",
  },
  raw: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
