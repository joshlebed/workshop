import { errorMessage } from "@workshop/api-client/api";
import { Button, confirm, ListRow, Text, TextField, tokens, useToast } from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../../hooks/useAuth";

/**
 * Settings → Connections → Letterboxd (3.5). A row that shows the connected
 * account and expands in place to connect, change or disconnect it. The
 * username powers every Letterboxd-match list the person is on.
 */
export function LetterboxdRow() {
  const { user, connectLetterboxd, disconnectLetterboxd } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState<"save" | "disconnect" | null>(null);
  const connected = user?.letterboxdUsername ?? null;

  const onSave = async () => {
    const name = username.trim().replace(/^@/, "");
    if (!name) return;
    setBusy("save");
    try {
      const filmCount = await connectLetterboxd(name);
      showToast({
        message: `Letterboxd connected. ${filmCount} ${filmCount === 1 ? "film" : "films"} on your watchlist.`,
        tone: "success",
      });
      setOpen(false);
      setUsername("");
    } catch (e) {
      showToast({
        message: errorMessage(e, "Couldn't connect that Letterboxd account."),
        tone: "danger",
      });
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Letterboxd?",
      message: "Match lists stop seeing your watchlist. Films already on lists stay.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    setBusy("disconnect");
    try {
      await disconnectLetterboxd();
      showToast({ message: "Letterboxd disconnected" });
      setOpen(false);
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't disconnect."), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <ListRow
        title="Letterboxd"
        subtitle={connected ? `Connected as @${connected}` : "Not connected"}
        trailing={
          <Text variant="label" tone="secondary">
            {open ? "Close" : connected ? "Change" : "Connect"}
          </Text>
        }
        onPress={() => setOpen((v) => !v)}
        accessibilityLabel={
          connected ? `Letterboxd, connected as ${connected}` : "Letterboxd, not connected"
        }
        testID="settings-letterboxd"
      />
      {open ? (
        <View style={styles.form} testID="settings-letterboxd-form">
          <TextField
            label="Letterboxd username"
            hint="Match lists use your watchlist to suggest films."
            value={username}
            onChangeText={setUsername}
            placeholder={connected ? `@${connected}` : "username"}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void onSave()}
            testID="settings-letterboxd-input"
          />
          <View style={styles.actions}>
            <Button
              label={connected ? "Save" : "Connect"}
              disabled={!username.trim() || busy !== null}
              loading={busy === "save"}
              onPress={() => void onSave()}
              testID="settings-letterboxd-save"
            />
            {connected ? (
              <Button
                label="Disconnect"
                variant="ghost"
                disabled={busy !== null}
                loading={busy === "disconnect"}
                onPress={() => void onDisconnect()}
                testID="settings-letterboxd-disconnect"
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.md,
  },
  actions: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
});
