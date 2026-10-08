import type { GameScoreDirection } from "@workshop/shared/games";
import { Button, Chip, Text, tokens } from "@workshop/ui";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { ROLE_TAG, SCORE_COPY } from "../lib/scoreCheck";
import type { ScoreCheck } from "../lib/useScoreCheck";

/**
 * What a post will record, under a score box — teach v2's states and copy.
 * Renders nothing for an account without teach (the caller keeps its legacy
 * preview) and nothing for an empty box. Never blocks the caller's own Post
 * button beyond `check.canPost`.
 */
export function ScoreCheckPanel({
  check,
  onPostToOther,
  testID = "score-check",
}: {
  check: ScoreCheck;
  /** "Post to Daily Tens" on a wrong-game warning. Omit to hide that action. */
  onPostToOther?: (gameId: string, title: string) => void;
  testID?: string;
}) {
  const { view } = check;
  if (!check.available || view.kind === "none") return null;

  // The server's reading is on its way. One quiet line where the reading will
  // go, so there is never an empty gap and nothing moves when "Score: 944"
  // replaces it.
  if (view.kind === "checking") {
    return (
      <View style={styles.root} testID={testID}>
        <CheckingNote visible testID={`${testID}-checking`} />
      </View>
    );
  }

  if (view.kind === "no_result_text") {
    return (
      <View style={styles.notice} testID={`${testID}-no-result-text`} accessibilityRole="alert">
        <Text variant="caption">{view.copy}</Text>
      </View>
    );
  }

  if (view.kind === "wrong_game") {
    return (
      <View style={styles.notice} testID={`${testID}-wrong-game`} accessibilityRole="alert">
        <Text variant="label">{view.copy}</Text>
        <View style={styles.actions}>
          {onPostToOther ? (
            <Button
              label={`Post to ${view.otherTitle}`}
              size="md"
              onPress={() => onPostToOther(view.otherGameId, view.otherTitle)}
              testID={`${testID}-post-there`}
            />
          ) : null}
          <Button
            label="Post here anyway"
            variant="ghost"
            size="md"
            onPress={check.dismissWrongGame}
            testID={`${testID}-post-here`}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      {check.sameTextWarning ? (
        <View style={styles.notice} testID={`${testID}-same-text`} accessibilityRole="alert">
          <Text variant="caption">{check.sameTextWarning}</Text>
        </View>
      ) : null}

      {view.kind === "score" ? (
        <View style={styles.readRow}>
          <Text variant="label" testID={`${testID}-read`}>
            {view.copy}
          </Text>
          {check.pickerOpen ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={check.openPicker}
              hitSlop={8}
              testID={`${testID}-not-right`}
            >
              <Text variant="caption" style={styles.link}>
                {SCORE_COPY.notRight}
              </Text>
            </Pressable>
          )}
        </View>
      ) : view.kind === "no_result" ? (
        <View style={styles.readRow}>
          <Text variant="caption" tone="muted" testID={`${testID}-read`}>
            {view.copy}
          </Text>
          {check.pickerOpen ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={check.openPicker}
              hitSlop={8}
              testID={`${testID}-not-right`}
            >
              <Text variant="caption" style={styles.link}>
                {SCORE_COPY.notRight}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {check.pickerOpen ? <Picker check={check} testID={testID} /> : null}
    </View>
  );
}

function Picker({ check, testID }: { check: ScoreCheck; testID: string }) {
  const selectedId = check.pick?.kind === "feature" ? check.pick.featureId : null;
  return (
    <View style={styles.picker} testID={`${testID}-picker`}>
      <View style={styles.pickerHeader}>
        <Text variant="caption" tone="muted" style={styles.pickerCaption}>
          {check.view.kind === "score" || check.view.kind === "no_result"
            ? "Tap your score:"
            : SCORE_COPY.unread}
        </Text>
        {/* The chips below are already tappable; this only says the server
            part (the dry run, the labels) is still coming. */}
        <CheckingNote visible={check.serverPending} testID={`${testID}-checking`} />
      </View>
      <View style={styles.chips}>
        {check.candidates.map((feature) => {
          const tag = ROLE_TAG[check.roles[feature.id] ?? "other"];
          return (
            <Chip
              key={feature.id}
              label={tag ? `${feature.label} · ${tag}` : feature.label}
              selected={selectedId === feature.id}
              onPress={() => check.choose(feature)}
              testID={`${testID}-candidate-${feature.id}`}
            />
          );
        })}
        <Chip
          label={SCORE_COPY.didNotFinish}
          selected={check.pick?.kind === "no_result"}
          onPress={check.chooseNoResult}
          testID={`${testID}-did-not-finish`}
        />
      </View>

      {check.mismatch ? (
        <View style={styles.notice} testID={`${testID}-mismatch`} accessibilityRole="alert">
          <Text variant="caption">{check.mismatch.copy}</Text>
          <View style={styles.actions}>
            <Button
              label={SCORE_COPY.useAnyway}
              size="md"
              onPress={check.confirmMismatch}
              testID={`${testID}-mismatch-confirm`}
            />
            <Button
              label={SCORE_COPY.pickAnother}
              variant="ghost"
              size="md"
              onPress={check.cancelMismatch}
              testID={`${testID}-mismatch-cancel`}
            />
          </View>
        </View>
      ) : null}

      {check.direction ? (
        <DirectionChips
          direction={check.direction}
          onChange={check.setDirection}
          testID={`${testID}-direction`}
        />
      ) : null}
    </View>
  );
}

/**
 * "Checking…" with a small spinner. In the picker it keeps its place when it
 * is done (invisible, not removed), so nothing shifts when the answer lands.
 */
function CheckingNote({ visible, testID }: { visible: boolean; testID: string }) {
  return (
    <View
      style={[styles.checking, visible ? null : styles.checkingDone]}
      // Absent from the tree's test ids and from assistive tech once done.
      {...(visible ? { testID, accessibilityRole: "progressbar" as const } : {})}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      aria-hidden={!visible}
    >
      <ActivityIndicator size="small" color={tokens.text.muted} animating={visible} />
      <Text variant="caption" tone="muted">
        {SCORE_COPY.checking}
      </Text>
    </View>
  );
}

/** "Lower is better" / "Higher is better" — confirmed by the user on a first teach. */
export function DirectionChips({
  direction,
  onChange,
  testID,
}: {
  direction: GameScoreDirection;
  onChange: (direction: GameScoreDirection) => void;
  testID: string;
}) {
  return (
    <View style={styles.direction}>
      <Text variant="caption" tone="muted">
        Which way does this game rank?
      </Text>
      <View style={styles.chips}>
        {(["asc", "desc"] as const).map((dir) => (
          <Chip
            key={dir}
            label={dir === "asc" ? "Lower is better" : "Higher is better"}
            selected={direction === dir}
            onPress={() => onChange(dir)}
            testID={`${testID}-${dir}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: tokens.space.sm },
  readRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space.md,
    minHeight: 24,
  },
  // One line high whether it holds "Checking…" or the reading.
  checking: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, minHeight: 24 },
  checkingDone: { opacity: 0 },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    minHeight: 24,
  },
  pickerCaption: { flexShrink: 1 },
  link: { color: tokens.accent.default, textDecorationLine: "underline" },
  picker: { gap: tokens.space.sm },
  direction: { gap: tokens.space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  notice: {
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.status.warning,
    backgroundColor: tokens.bg.surface,
  },
});
