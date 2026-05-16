import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { createInvite } from "../../src/api/invites";
import { useAuth } from "../../src/hooks/useAuth";
import { ApiError } from "../../src/lib/api";
import { queryKeys } from "../../src/lib/queryKeys";
import { buildInviteShareUrl, copyToClipboard } from "../../src/lib/share";
import { Button, IconButton, Text, tokens, useToast } from "../../src/ui/index";

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
          message: "Invite created but token missing. Open settings to retry.",
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
        <Text variant="caption" tone="muted" style={styles.step}>
          Last step
        </Text>
        <IconButton
          accessibilityLabel="Skip"
          onPress={goToList}
          testID="create-list-share-skip-icon"
        >
          <Text style={styles.skipGlyph}>✕</Text>
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text variant="title" style={styles.lead}>
            Bring people in
          </Text>
          <Text tone="secondary" style={styles.leadSub}>
            Anyone with the link can join. Links last 7 days and can be revoked from list settings.
          </Text>
        </View>

        {shareUrl ? (
          <View style={styles.linkBlock}>
            <Text variant="label" tone="secondary" style={styles.linkLabel}>
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
                  message: ok ? "Copied" : "Couldn't copy. Try copying the link manually.",
                  tone: ok ? "success" : "danger",
                });
              }}
            />
          </View>
        ) : (
          <View style={styles.emptyBlock}>
            <View style={styles.emptyGlyphBadge}>
              <Text style={styles.emptyGlyph}>↗</Text>
            </View>
            <Text tone="secondary" style={styles.emptyText}>
              Mint a one-tap invite for the people you want to share this list with. You can also
              skip this and share later from settings.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            testID="create-list-share-generate"
            label={shareUrl ? "Generate another link" : "Generate share link"}
            size="lg"
            loading={generateMutation.isPending}
            disabled={generateMutation.isPending}
            onPress={() => generateMutation.mutate()}
          />
          <Button
            testID="create-list-share-done"
            label={shareUrl ? "Done" : "Skip for now"}
            variant={shareUrl ? "primary" : "ghost"}
            size="lg"
            onPress={goToList}
          />
        </View>
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
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.md,
  },
  headerSpacer: { width: 40 },
  step: { letterSpacing: 0.3 },
  skipGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  intro: { gap: tokens.space.xs },
  lead: { letterSpacing: -0.4 },
  leadSub: { fontSize: tokens.font.size.md, lineHeight: 22 },
  linkBlock: { gap: tokens.space.md },
  linkLabel: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
  urlBox: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    backgroundColor: tokens.bg.surface,
  },
  urlText: { color: tokens.text.primary, fontSize: tokens.font.size.sm },
  emptyBlock: {
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.lg,
  },
  emptyGlyphBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
  },
  emptyGlyph: { fontSize: 28, color: tokens.accent.default },
  emptyText: { textAlign: "center", maxWidth: 360, lineHeight: 22 },
  actions: { gap: tokens.space.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
