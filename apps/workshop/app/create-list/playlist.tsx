import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListColor } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { previewSpotifyPlaylist } from "../../src/api/albumShelf";
import { createList } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { ApiError } from "../../src/lib/api";
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

  const previewError =
    previewQuery.isError && previewQuery.error instanceof ApiError
      ? previewMessageFromApiError(previewQuery.error)
      : previewQuery.isError
        ? "Couldn't read that playlist. Try again?"
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
      const message =
        e instanceof ApiError
          ? messageFromApiError(e)
          : e instanceof Error
            ? e.message
            : "Couldn't create the album shelf";
      showToast({ message, tone: "danger" });
    },
  });

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="album-shelf-playlist-back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </IconButton>
        <Text variant="heading">Source playlist</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <Text tone="secondary" style={styles.tagline}>
          Paste a public Spotify playlist URL. Your shelf will pull every album the playlist
          references.
        </Text>

        <Card style={styles.card} elevated>
          <View style={styles.field}>
            <Text variant="label" tone="secondary">
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
          </View>
          <Text variant="caption" tone="muted">
            We use Workshop's Spotify app to read the playlist — no Spotify sign-in needed. Private
            playlists won't work.
          </Text>
        </Card>

        {preview ? (
          <Card style={styles.previewCard} elevated testID="album-shelf-playlist-preview">
            <Text variant="label" tone="secondary">
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

      {/* Submit lives outside the scroll so it sticks above the keyboard
          (KeyboardAvoidingView shrinks the available space; the button stays
          at its bottom edge instead of getting trapped inside scrollable
          content). */}
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
    </KeyboardAvoidingView>
  );
}

function previewMessageFromApiError(e: ApiError): string {
  const code = (e.details as { code?: string } | undefined)?.code;
  if (code === "INVALID_PLAYLIST_URL") return "That doesn't look like a Spotify playlist URL.";
  if (code === "PLAYLIST_NOT_AVAILABLE")
    return "That playlist isn't public. Make it public on Spotify and try again.";
  if (code === "SPOTIFY_UNAVAILABLE") return "Spotify is having a moment. Give it a beat.";
  return e.message;
}

function messageFromApiError(e: ApiError): string {
  const code = (e.details as { code?: string } | undefined)?.code;
  if (code === "INVALID_PLAYLIST_URL") return "That doesn't look like a Spotify playlist URL.";
  if (code === "PLAYLIST_NOT_AVAILABLE")
    return "We couldn't read that playlist. Make sure it's public and try again.";
  if (code === "SPOTIFY_UNAVAILABLE")
    return "Spotify is having a moment. Give it a beat and try again.";
  return e.message;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  scroll: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
  },
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.lg,
  },
  footer: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    backgroundColor: tokens.bg.canvas,
  },
  tagline: { textAlign: "left" },
  card: { gap: tokens.space.md },
  previewCard: {
    gap: tokens.space.xs,
    borderColor: tokens.accent.default,
    borderWidth: 1,
  },
  field: { gap: tokens.space.sm },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
  },
  previewStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingTop: tokens.space.xs,
  },
});
