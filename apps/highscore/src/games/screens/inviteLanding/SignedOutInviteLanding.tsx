// The signed-out face of an invite link (`/g/:token`, `/friends/accept/:token`)
// — score before sign-in, onboarding spike 1. Instead of bouncing a visitor to
// a context-free sign-in, show who invited them, what the sharer played
// today (play links), and a paste box that reads their own result locally.
// Nothing is sent until they sign in; then the landing posts the stashed
// draft (`usePreloginDraftPost`) and opens the board.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../../theme";
import { type InviteLandingInviter, usePreloginDraftEditor } from "../../hooks/usePreloginDraft";
import {
  type DraftReading,
  type InviteLinkKind,
  readDraftText,
  sharerPlayedGame,
} from "../../lib/preloginDraft";

export function SignedOutInviteLanding({
  linkKind,
  linkToken,
  inviter,
  sharerGames,
  testID,
}: {
  linkKind: InviteLinkKind;
  linkToken: string;
  inviter: InviteLandingInviter;
  /** Titles the sharer posted today (play links; empty for friend invites). */
  sharerGames: readonly string[];
  testID: string;
}) {
  const name = inviter.displayName?.trim() || "Someone";
  const editor = usePreloginDraftEditor({ linkKind, linkToken, inviter, sharerGames });
  const { reading } = editor;
  const recognized = reading.kind === "recognized" ? reading : null;
  const signInLabel = recognized
    ? `Sign in to save your ${recognized.gameTitle} score`
    : linkKind === "play"
      ? `Sign in to compare with ${name}`
      : `Sign in to add ${name}`;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      <Card style={styles.card} elevated>
        <View style={styles.inviter}>
          <Avatar
            name={inviter.displayName}
            imageUrl={userAvatarImageUrl(inviter.userId)}
            size="lg"
          />
          <Text variant="title" style={styles.center} testID={`${testID}-title`}>
            {linkKind === "play"
              ? `${name} wants to compare scores`
              : `${name} wants to be friends`}
          </Text>
          <Text tone="secondary" style={styles.center}>
            HighScore puts your daily game results side by side with your friends'.
          </Text>
        </View>

        {sharerGames.length > 0 ? (
          <View style={styles.section} testID={`${testID}-sharer-games`}>
            <Text variant="overline" tone="secondary">
              {name} played today
            </Text>
            <View style={styles.gameChips}>
              {sharerGames.map((title) => (
                <View
                  key={title}
                  style={[
                    styles.gameChip,
                    recognized && sharerPlayedGame(recognized.gameTitle, [title])
                      ? styles.gameChipMatched
                      : null,
                  ]}
                >
                  <Text variant="label" numberOfLines={1}>
                    {title}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text variant="overline" tone="secondary">
            Played today? Paste your result
          </Text>
          <TextInput
            testID={`${testID}-paste`}
            value={editor.text}
            onChangeText={editor.setText}
            placeholder={
              sharerGames.length > 0
                ? `Paste the result you'd share from ${sharerGames[0]}`
                : "Paste the result you'd share from Wordle, MapTap, Daily Tens…"
            }
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={2000}
            style={styles.input}
            accessibilityLabel="Paste your game result"
          />
          <DraftReadingView
            reading={reading}
            sharerName={name}
            sharerGames={sharerGames}
            testID={testID}
          />
        </View>

        <Button
          label={signInLabel}
          size="lg"
          onPress={() => void editor.goToSignIn()}
          testID={`${testID}-sign-in`}
        />
        {recognized ? (
          <Button
            label="Clear score"
            variant="ghost"
            onPress={editor.clear}
            testID={`${testID}-clear`}
          />
        ) : null}
        <Text variant="caption" tone="muted" style={styles.center}>
          {recognized
            ? "Your score stays on this device until you sign in. Then it's posted and shared with your friends on HighScore."
            : "Nothing you paste here leaves this device until you sign in."}
        </Text>
      </Card>
    </ScrollView>
  );
}

function DraftReadingView({
  reading,
  sharerName,
  sharerGames,
  testID,
}: {
  reading: DraftReading;
  sharerName: string;
  sharerGames: readonly string[];
  testID: string;
}) {
  switch (reading.kind) {
    case "empty":
      return null;
    case "resultless":
      return (
        <Text variant="caption" tone="danger" testID={`${testID}-resultless`}>
          {reading.gameTitle
            ? `That's just the ${reading.gameTitle} link. `
            : "That's just a link. "}
          Paste the result text the game gave you.
        </Text>
      );
    case "unrecognized":
      return (
        <Text variant="caption" tone="secondary" testID={`${testID}-unrecognized`}>
          We don't recognise that game from here. Sign in and you can add any game by its link.
        </Text>
      );
    case "recognized": {
      const matched = sharerPlayedGame(reading.gameTitle, sharerGames);
      return (
        <View style={styles.draftCard} testID={`${testID}-draft`}>
          <View style={styles.draftHeader}>
            <Text variant="game" numberOfLines={1} style={styles.draftTitle}>
              {reading.gameTitle}
            </Text>
            {reading.scoreDisplay ? (
              <Text variant="score" tone="spotlight" testID={`${testID}-draft-score`}>
                {reading.scoreDisplay}
              </Text>
            ) : null}
          </View>
          {reading.summary ? (
            <Text variant="caption" tone="secondary" numberOfLines={4}>
              {reading.summary}
            </Text>
          ) : null}
          <Text variant="caption" tone={matched ? "success" : "muted"}>
            {matched
              ? `${sharerName} played this today — sign in to see who won.`
              : "Sign in to save it to your board."}
          </Text>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bg.canvas },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
  },
  card: { gap: tokens.space.lg, maxWidth: 420, width: "100%", alignSelf: "center" },
  inviter: { alignItems: "center", gap: tokens.space.sm },
  center: { textAlign: "center" },
  section: { gap: tokens.space.sm },
  gameChips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.xs },
  gameChip: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
  },
  gameChipMatched: { borderColor: tokens.accent.default },
  // 16px floor: iOS Safari zooms a focused field under 16px (root CLAUDE.md).
  input: {
    minHeight: 96,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.elevated,
    textAlignVertical: "top",
  },
  draftCard: {
    gap: tokens.space.xs,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.accent.default,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
  },
  draftHeader: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  draftTitle: { flex: 1 },
});

/**
 * The stashed draft on the signed-in accept card: "Your MapTap score · 937",
 * saved when the visitor adds the inviter (or taps Not now).
 */
export function DraftScoreRow({
  gameTitle,
  scoreRaw,
  testID,
}: {
  gameTitle: string;
  scoreRaw: string;
  testID: string;
}) {
  const reading = readDraftTextSafe(scoreRaw);
  return (
    <View style={styles.draftCard} testID={testID}>
      <View style={styles.draftHeader}>
        <Text variant="game" numberOfLines={1} style={styles.draftTitle}>
          {gameTitle}
        </Text>
        {reading ? (
          <Text variant="score" tone="spotlight">
            {reading}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        Your score from before you signed in — it's saved when you continue.
      </Text>
    </View>
  );
}

function readDraftTextSafe(scoreRaw: string): string | null {
  const reading = readDraftText(scoreRaw);
  return reading.kind === "recognized" ? reading.scoreDisplay : null;
}
