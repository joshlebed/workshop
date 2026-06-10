import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListColor, SourcePreview } from "@workshop/shared";
import type { SourceKind } from "@workshop/shared/sourceKinds";
import { LIST_TEMPLATES, type ListTemplate } from "@workshop/shared/templates";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createList } from "../../src/api/lists";
import { previewSource } from "../../src/api/sources";
import { useAuth } from "../../src/hooks/useAuth";
import { goBack } from "../../src/lib/goBack";
import { queryKeys } from "../../src/lib/queryKeys";
import { sourceErrorMessage } from "../../src/lib/sourceErrors";
import { Button, Card, IconButton, Screen, Text, tokens, useToast } from "../../src/ui/index";

function pickString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function lookupTemplate(id: string): ListTemplate {
  return (
    LIST_TEMPLATES.find((t) => t.id === id) ?? LIST_TEMPLATES.find((t) => t.id === "album_shelf")!
  );
}

// Per-source-kind copy + payload shape. New source kinds add an entry here;
// the screen body is otherwise kind-agnostic.
interface SourceCopy {
  lead: string;
  defaultPrompt: string;
  fieldLabel: string;
  placeholder: string;
  hint: string;
  submitLabel: string;
  checkingLabel: string;
  errorFallback: string;
  createErrorFallback: string;
}

const SOURCE_COPY: Record<SourceKind, SourceCopy> = {
  spotify_playlist: {
    lead: "Point us at a playlist",
    defaultPrompt:
      "Paste a public Spotify playlist URL. Your shelf will pull every album it references.",
    fieldLabel: "Playlist URL",
    placeholder: "https://open.spotify.com/playlist/…",
    hint: "No Spotify sign-in needed. Private playlists won't work.",
    submitLabel: "Create shelf",
    checkingLabel: "Checking playlist…",
    errorFallback: "Couldn't read that playlist. Try again?",
    createErrorFallback: "Couldn't create the album shelf",
  },
  letterboxd_list: {
    lead: "Point us at a list",
    defaultPrompt:
      "Paste a public Letterboxd list URL. Workshop will mirror it as a watchlist, enriched via TMDB.",
    fieldLabel: "Letterboxd URL",
    placeholder: "https://letterboxd.com/<user>/list/<slug>/",
    hint: "No Letterboxd sign-in needed. Private lists won't work.",
    submitLabel: "Create watchlist",
    checkingLabel: "Checking list…",
    errorFallback: "Couldn't read that list. Try again?",
    createErrorFallback: "Couldn't create the watchlist",
  },
  // letterboxd_match never routes through this screen (it's attached as an
  // autoSource with no URL prompt); the entry keeps the record exhaustive
  // for the SourceKind union.
  letterboxd_match: {
    lead: "Letterboxd Match",
    defaultPrompt: "Workshop matches films across members' Letterboxd watchlists.",
    fieldLabel: "",
    placeholder: "",
    hint: "",
    submitLabel: "Create list",
    checkingLabel: "Checking…",
    errorFallback: "Couldn't set up Letterboxd matching. Try again?",
    createErrorFallback: "Couldn't create the list",
  },
};

function buildConfig(kind: SourceKind, rawUrl: string): Record<string, unknown> {
  switch (kind) {
    case "spotify_playlist":
      return { spotifyPlaylistUrl: rawUrl };
    case "letterboxd_list":
      return { letterboxdUrl: rawUrl };
    case "letterboxd_match":
      return {};
  }
}

const PREVIEW_DEBOUNCE_MS = 500;

export default function CreateListPlaylist() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    template?: string;
    name?: string;
    emoji?: string;
    color?: string;
    description?: string;
  }>();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const template = lookupTemplate(pickString(params.template));
  // The customize step only routes us here if the template declares a source.
  // Fall through to spotify_playlist if a stale link arrives without one so
  // we never crash; the create call below would just no-op.
  const sourceKind: SourceKind = template.requiresSource?.kind ?? "spotify_playlist";
  const copy = SOURCE_COPY[sourceKind];

  const name = pickString(params.name);
  const emoji = pickString(params.emoji);
  const color = (pickString(params.color) || template.defaults.color) as ListColor;
  const description = pickString(params.description);

  const [url, setUrl] = useState("");
  const trimmedUrl = url.trim();
  const [debouncedUrl, setDebouncedUrl] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(trimmedUrl), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmedUrl]);

  const previewQuery = useQuery({
    queryKey: queryKeys.sourcePreview.forKind(sourceKind, debouncedUrl),
    queryFn: () =>
      previewSource(
        {
          kind: sourceKind,
          config: buildConfig(sourceKind, debouncedUrl),
        },
        token,
      ),
    enabled: !!token && debouncedUrl.length > 0,
    retry: false,
    staleTime: 60_000,
  });

  const previewError = previewQuery.isError
    ? sourceErrorMessage(previewQuery.error, copy.errorFallback, "creation")
    : null;
  const preview: SourcePreview | null =
    previewQuery.isSuccess && previewQuery.data.preview.kind === sourceKind
      ? previewQuery.data.preview
      : null;
  const previewing = previewQuery.isFetching && !previewQuery.isSuccess;

  const canSubmit = !!preview && trimmedUrl === debouncedUrl;

  const mutation = useMutation({
    mutationFn: () =>
      createList(
        {
          name,
          emoji,
          color,
          itemKind: template.defaults.itemKind,
          modules: template.defaults.modules,
          ...(description.length > 0 ? { description } : {}),
          sources: [
            {
              kind: sourceKind,
              config: buildConfig(sourceKind, trimmedUrl),
            },
          ],
        },
        token,
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.dismissAll();
      router.replace(`/list/${res.list.id}`);
    },
    onError: (e) => {
      showToast({
        message: sourceErrorMessage(e, copy.createErrorFallback, "creation"),
        tone: "danger",
      });
    },
  });

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => goBack("/create-list/type")}
          testID="source-playlist-back"
        >
          <Text style={styles.backGlyph}>‹</Text>
        </IconButton>
        <View style={styles.stepDots} accessibilityLabel="Step 3 of 3">
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={[styles.stepDot, styles.stepDotActive]} />
        </View>
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
            {copy.lead}
          </Text>
          <Text tone="secondary" style={styles.tagline}>
            {template.requiresSource?.promptCopy ?? copy.defaultPrompt}
          </Text>
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary" style={styles.fieldLabel}>
            {copy.fieldLabel}
          </Text>
          <TextInput
            testID="source-playlist-url"
            value={url}
            onChangeText={setUrl}
            placeholder={copy.placeholder}
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
                {copy.checkingLabel}
              </Text>
            </View>
          ) : null}
          {!previewing && previewError ? (
            <Text variant="caption" tone="danger" testID="source-playlist-error">
              {previewError}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.hint}>
            {copy.hint}
          </Text>
        </View>

        {preview ? (
          <Card style={styles.previewCard} elevated testID="source-playlist-preview">
            <Text variant="caption" tone="muted" style={styles.previewKind}>
              Preview
            </Text>
            <SourcePreviewBody preview={preview} />
          </Card>
        ) : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <Button
            testID="source-playlist-submit"
            label={copy.submitLabel}
            size="lg"
            disabled={!canSubmit || mutation.isPending}
            loading={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

function SourcePreviewBody({ preview }: { preview: SourcePreview }) {
  if (preview.kind === "spotify_playlist") {
    return (
      <>
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
      </>
    );
  }
  if (preview.kind === "letterboxd_list") {
    return (
      <>
        <Text variant="heading" numberOfLines={1}>
          {preview.slug === "watchlist" ? `${preview.username}'s watchlist` : preview.slug}
        </Text>
        <Text tone="secondary" numberOfLines={1}>
          by {preview.username}
        </Text>
        <Text variant="caption" tone="muted">
          {preview.filmCount} {preview.filmCount === 1 ? "film" : "films"}
        </Text>
      </>
    );
  }
  // letterboxd_match has no URL-derived preview (it never routes here).
  return null;
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
  stepDots: { flexDirection: "row", gap: 6, alignItems: "center" },
  stepDot: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
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
