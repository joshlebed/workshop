import { Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { recognizedGameLabel, wrongGameMatch } from "../lib/recognition";
import { useRecognizedGame } from "../lib/useRecognizedGame";

/**
 * A heads-up under a score box when the text is recognizably a score for a
 * different game than the one being posted to. Renders nothing otherwise —
 * including when recognition is off for the account, has no answer, or agrees
 * — and never blocks posting: the user may know better than we do.
 */
export function WrongGameNotice({
  text,
  gameId,
  gameTitle,
}: {
  text: string;
  /** The game the score is about to be posted to. */
  gameId: string | null | undefined;
  gameTitle: string;
}) {
  const other = wrongGameMatch(useRecognizedGame(text), gameId);
  if (!other) return null;
  return (
    <View style={styles.notice} testID="wrong-game-notice" accessibilityRole="alert">
      <Text variant="label">This looks like a {recognizedGameLabel(other)} score</Text>
      <Text variant="caption" tone="muted">
        You're posting it to {gameTitle}. Post anyway if that's right.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: 2,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.status.warning,
    backgroundColor: tokens.bg.surface,
  },
});
