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

import { useEffect, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { Avatar, Button, Sheet, Text, tokens } from "../../ui/index";

interface GameScorePasteSheetProps<T extends { title: string }> {
  /** Target game, or `null` when the sheet should be closed. */
  item: T | null;
  userName: string | null;
  userAvatarUrl?: string | null;
  pending: boolean;
  onSubmit: (item: T, scoreRaw: string) => void;
  onClose: () => void;
}

export function GameScorePasteSheet<T extends { title: string }>({
  item,
  userName,
  userAvatarUrl,
  pending,
  onSubmit,
  onClose,
}: GameScorePasteSheetProps<T>) {
  const [snapshot, setSnapshot] = useState<T | null>(item);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (item) {
      setSnapshot(item);
      setDraft("");
    }
  }, [item]);

  const visible = !!item;
  const empty = draft.trim().length === 0;
  const submit = () => {
    if (snapshot && !empty && !pending) onSubmit(snapshot, draft.trim());
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
            onChangeText={setDraft}
            placeholder={"Paste your result here"}
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={2000}
            autoFocus
            style={styles.input}
            {...webProps}
          />
          <View style={styles.actions}>
            <Button label="Not yet" variant="ghost" onPress={onClose} disabled={pending} />
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
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
