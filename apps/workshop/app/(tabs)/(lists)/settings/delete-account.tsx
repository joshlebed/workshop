import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { Button, Screen, ScreenHeader, Text, TextField, tokens } from "@workshop/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { fetchLists } from "../../../../src/api/lists";
import { useAuth } from "../../../../src/hooks/useAuth";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  accountDeletionBlockMessage,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  confirmationMatches,
  DELETE_CONFIRM_WORD,
} from "../../../../src/lib/accountDeletion";
import { goBack } from "../../../../src/lib/goBack";

/**
 * Delete account (UX pass 4.5). States what goes, including the HighScore
 * half of the shared account, asks for a typed word, then calls
 * `DELETE /v1/users/me`. Success signs out; the sign-in screen then reports
 * what happened to Apple's sign-in access. A failure leaves everything as it
 * was and says so. Blocked while impersonating.
 */
export default function DeleteAccount() {
  const { token, impersonation, deleteAccount } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = accountDeletionBlockReason({ token, impersonation });

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });
  const owned = (listsQuery.data?.lists ?? []).filter((l) => l.role === "owner");
  const sharedOwned = owned.filter((l) => l.memberCount > 1).length;

  const canDelete = !blocked && confirmationMatches(typed) && !busy;
  const onDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      // Signs out on success; AuthGate takes it from there.
      await deleteAccount();
    } catch (e) {
      setError(accountDeletionErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/settings")}
        leadingTestID="delete-account-back"
        title="Delete account"
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text variant="heading">Deleting your account is permanent</Text>
        <View style={styles.list}>
          {ACCOUNT_DELETION_CONSEQUENCES.map((line) => (
            <View key={line} style={styles.bullet}>
              <View style={styles.bulletDot} />
              <Text tone="secondary" style={styles.bulletText}>
                {line}
              </Text>
            </View>
          ))}
        </View>
        {owned.length > 0 ? (
          <Text tone="primary" testID="delete-account-owned">
            {`You own ${owned.length} ${owned.length === 1 ? "list" : "lists"}`}
            {sharedOwned > 0
              ? `, and ${sharedOwned} ${sharedOwned === 1 ? "is" : "are"} shared with other people.`
              : "."}
          </Text>
        ) : null}

        {blocked ? (
          <Text tone="secondary" testID="delete-account-blocked">
            {accountDeletionBlockMessage(blocked)}
          </Text>
        ) : null}

        <TextField
          label={`Type “${DELETE_CONFIRM_WORD}” to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!blocked && !busy}
          returnKeyType="done"
          onSubmitEditing={() => void onDelete()}
          testID="delete-account-confirm"
        />
        {error ? (
          <Text tone="danger" testID="delete-account-error" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          label="Delete my account"
          variant="danger"
          size="lg"
          disabled={!canDelete}
          loading={busy}
          onPress={() => void onDelete()}
          testID="delete-account-submit"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.lg,
  },
  list: { gap: tokens.space.md },
  bullet: { flexDirection: "row", gap: tokens.space.md, alignItems: "flex-start" },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 9,
    backgroundColor: tokens.text.muted,
  },
  bulletText: { flex: 1, lineHeight: 22 },
});
