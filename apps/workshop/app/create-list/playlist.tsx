import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListColor } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { previewSpotifyPlaylist } from "../../src/api/albumShelf";
import { createList } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { albumShelfErrorMessage } from "../../src/lib/albumShelfErrors";
import { goBack } from "../../src/lib/goBack";
import { queryKeys } from "../../src/lib/queryKeys";
import { Button, Card, IconButton, Text, tokens, useToast } from "../../src/ui/index";

function pickString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

const PREVIEW_DEBOUNCE_MS = 500;

export default function CreateListPlaylist() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    type?: string;
    name?: string;
    emoji?: string;
    color?: string;
    description?: string;
  }>();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const name = pickString(params.name);
  const emoji = pickString(params.emoji);
  const color = pickString(params.color) as ListColor;
  const description = pickString(params.description);

  const [url, setUrl] = useState("");
  const trimmedUrl = url.trim();
  // Debounce the trimmed URL so we don't fire a backend preview on every
  // keystroke. Spec §4.1 calls for blur-validation, but on web a debounced-
  // typing trigger is the closest approximation that also works on iOS where
  // there's no real "blur" event before the user taps Continue.
  const [debouncedUrl, setDebouncedUrl] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(trimmedUrl), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmedUrl]);

  const previewQuery = useQuery({
    queryKey: queryKeys.albumShelf.preview(debouncedUrl),
    queryFn: () => previewSpotifyPlaylist(debouncedUrl, token),
    enabled: !!token && debouncedUrl.length > 0,
    retry: false,
    // Cache previews so backing out + re-entering doesn't re-hit Spotify.
    staleTime: 60_000,
  });

  const previewError = previewQuery.isError
    ? albumShelfErrorMessage(
        previewQuery.error,
        "Couldn't read that playlist. Try again?",
        "creation",
      )
    : null;
  const preview = previewQuery.isSuccess ? previewQuery.data : null;
  const previewing = previewQuery.isFetching && !previewQuery.isSuccess;

  // Continue requires a successful preview. Per spec §4.1: "On success:
  // Continue enables. On 404 / private / malformed: Continue stays disabled."
  const canSubmit = !!preview && trimmedUrl === debouncedUrl;

  const mutation = useMutation({
    mutationFn: () =>
      createList(
        {
          type: "album_shelf",
          name,
          emoji,
          color,
          ...(description.length > 0 ? { description } : {}),
          spotifyPlaylistUrl: trimmedUrl,
        },
        token,
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace(`/create-list/share?listId=${res.list.id}`);
    },
    onError: (e) => {
      showToast({
        message: albumShelfErrorMessage(e, "Couldn't create the album shelf", "creation"),
        tone: "danger",
      });
    },
  });

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => goBack("/create-list/type")}
          testID="album-shelf-playlist-back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </IconButton>
        <Text variant="caption" tone="muted" style={styles.step}>
          Step 3 of 3
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <View style={styles.intro}>
          <Text variant="title" style={styles.lead}>
            Point us at a playlist
          </Text>
          <Text tone="secondary" style={styles.tagline}>
            Paste a public Spotify playlist URL. Your shelf will pull every album it references.
          </Text>
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary" style={styles.fieldLabel}>
            Playlist URL
          </Text>
          <TextInput
            testID="album-shelf-playlist-url"
            value={url}
            onChangeText={setUrl}
            placeholder="https://open.spotify.com/playlist/…"
            placeholderTextColor={tokens.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            keyboardType="url"
            maxLength={2048}
            style={styles.input}
          />
          {previewing ? (
            <View style={styles.previewStatus}>
              <ActivityIndicator color={tokens.text.muted} size="small" />
              <Text variant="caption" tone="muted">
                Checking playlist…
              </Text>
            </View>
          ) : null}
          {!previewing && previewError ? (
            <Text variant="caption" tone="danger" testID="album-shelf-playlist-error">
              {previewError}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.hint}>
            No Spotify sign-in needed. Private playlists won't work.
          </Text>
        </View>

        {preview ? (
          <Card style={styles.previewCard} elevated testID="album-shelf-playlist-preview">
            <Text variant="caption" tone="muted" style={styles.previewKind}>
              Preview
            </Text>
            <Text variant="heading" numberOfLines={1}>
              {preview.name}
            </Text>
            {preview.ownerName ? (
              <Text tone="secondary" numberOfLines={1}>
                by {preview.ownerName}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              {preview.trackCount} {preview.trackCount === 1 ? "track" : "tracks"}
            </Text>
          </Card>
        ) : null}
      </KeyboardAwareScrollView>

      {/* See customize.tsx — `KeyboardStickyView` is the right primitive for
          a CTA pinned above the keyboard; it tracks the real keyboard frame
          including the iOS suggestions strip. */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <Button
            testID="album-shelf-playlist-submit"
            label="Create shelf"
            size="lg"
            disabled={!canSubmit || mutation.isPending}
            loading={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  scroll: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.md,
  },
  step: { letterSpacing: 0.3 },
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.xl,
  },
  footer: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    backgroundColor: tokens.bg.canvas,
  },
  intro: { gap: tokens.space.xs },
  lead: { letterSpacing: -0.4 },
  tagline: { fontSize: tokens.font.size.md, lineHeight: 22 },
  previewCard: {
    gap: tokens.space.xs,
    borderColor: tokens.accent.default,
    borderWidth: 1,
  },
  previewKind: { letterSpacing: 0.2 },
  field: { gap: tokens.space.sm },
  fieldLabel: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
  hint: { lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.surface,
  },
  previewStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingTop: tokens.space.xs,
  },
});
