import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { createInvite } from "../../src/api/invites";
import { useAuth } from "../../src/hooks/useAuth";
import { ApiError } from "../../src/lib/api";
import { queryKeys } from "../../src/lib/queryKeys";
import { buildInviteShareUrl, copyToClipboard } from "../../src/lib/share";
import { Button, Card, IconButton, Text, tokens, useToast } from "../../src/ui/index";

/**
 * Final step of the create-list flow: offer to mint a share link before
 * dropping the user into the list. Reuses the invite primitives from 3a-1
 * — no new wrappers — and stores the freshly-minted URL in component state
 * since the server intentionally never re-emits the token (cf. 3a-1
 * `Invite.token` response-only convention).
 */
export default function CreateListShare() {
  const router = useRouter();
  const params = useLocalSearchParams<{ listId?: string }>();
  const listId = Array.isArray(params.listId) ? params.listId[0] : params.listId;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!listId) throw new Error("missing list id");
      return createInvite(listId, {}, token);
    },
    onSuccess: async (res) => {
      const fresh = res.invite;
      if (!fresh.token) {
        showToast({
          message: "Invite created but token missing — open settings to retry.",
          tone: "danger",
        });
        return;
      }
      const url = buildInviteShareUrl(fresh.token);
      setShareUrl(url);
      if (listId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.invites.forList(listId) });
      }
      const ok = await copyToClipboard(url);
      showToast({
        message: ok ? "Share link copied to clipboard" : "Share link generated",
        tone: ok ? "success" : "default",
      });
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't generate invite",
        tone: "danger",
      });
    },
  });

  const goToList = () => {
    if (!listId) {
      router.replace("/");
      return;
    }
    router.dismissAll();
    router.replace(`/list/${listId}`);
  };

  if (!listId) {
    return (
      <View style={styles.center}>
        <Text>Missing list id</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text variant="heading">Share</Text>
        <IconButton
          accessibilityLabel="Skip"
          onPress={goToList}
          testID="create-list-share-skip-icon"
        >
          <Text style={styles.skipGlyph}>✕</Text>
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Card style={styles.card} elevated>
          <Text variant="heading">Invite collaborators</Text>
          <Text tone="secondary">
            Generate a share link to invite people to this list. Anyone with the link can join — it
            expires after 7 days, and you can revoke it any time from list settings.
          </Text>
          {shareUrl ? (
            <View style={styles.field}>
              <Text variant="caption" tone="muted">
                Share link
              </Text>
              <View style={styles.urlBox}>
                <Text
                  style={styles.urlText}
                  numberOfLines={1}
                  selectable
                  testID="create-list-share-url"
                >
                  {shareUrl}
                </Text>
              </View>
              <Button
                testID="create-list-share-copy"
                label="Copy link"
                variant="secondary"
                size="md"
                onPress={async () => {
                  const ok = await copyToClipboard(shareUrl);
                  showToast({
                    message: ok ? "Copied" : "Couldn't copy — copy the link manually",
                    tone: ok ? "success" : "danger",
                  });
                }}
              />
            </View>
          ) : null}
          <Button
            testID="create-list-share-generate"
            label={shareUrl ? "Generate another link" : "Generate share link"}
            size="md"
            loading={generateMutation.isPending}
            disabled={generateMutation.isPending}
            onPress={() => generateMutation.mutate()}
          />
        </Card>

        <Button
          testID="create-list-share-done"
          label={shareUrl ? "Done" : "Skip for now"}
          variant={shareUrl ? "primary" : "ghost"}
          size="lg"
          onPress={goToList}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
  },
  headerSpacer: { width: 40 },
  skipGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  card: { gap: tokens.space.md },
  field: { gap: tokens.space.sm },
  urlBox: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    backgroundColor: tokens.bg.surface,
  },
  urlText: { color: tokens.text.primary, fontSize: tokens.font.size.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
