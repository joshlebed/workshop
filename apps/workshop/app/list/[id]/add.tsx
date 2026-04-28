import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BookResult,
  BookSearchResponse,
  CreateItemRequest,
  LinkPreview,
  LinkPreviewResponse,
  ListType,
  MediaResult,
  MediaSearchResponse,
  MediaSearchType,
} from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { createItem } from "../../../src/api/items";
import { fetchLinkPreview } from "../../../src/api/linkPreview";
import { fetchListDetail } from "../../../src/api/lists";
import { searchBooks, searchMedia } from "../../../src/api/search";
import { useAuth } from "../../../src/hooks/useAuth";
import { useDebouncedQuery } from "../../../src/hooks/useDebouncedQuery";
import { ApiError } from "../../../src/lib/api";
import { haptics } from "../../../src/lib/haptics";
import { queryKeys } from "../../../src/lib/queryKeys";
import {
  Button,
  Card,
  IconButton,
  SearchResultRow,
  Text,
  tokens,
  useToast,
} from "../../../src/ui/index";

const SEARCH_TYPES: readonly ListType[] = ["movie", "tv", "book"];

export default function AddItem() {
  const params = useLocalSearchParams<{ id: string; prefillUrl?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const prefillUrlParam = Array.isArray(params.prefillUrl)
    ? params.prefillUrl[0]
    : params.prefillUrl;
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Fetch the parent list so the screen knows whether to render the search
  // flow (movie/tv/book) or the free-form flow (date_idea/trip). The list
  // detail screen already populates this query; the cached read is instant.
  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id ?? ""),
    queryFn: () => fetchListDetail(id ?? "", token),
    enabled: !!token && !!id,
  });
  const listType = listQuery.data?.list.type;
  const isSearchType = !!listType && SEARCH_TYPES.includes(listType);

  // Free-form fields (date_idea / trip). When the screen is reached via the
  // share flow (`?prefillUrl=…`), seed the URL field so the user just picks
  // a title + saves; the link-preview debounce auto-fires off the seeded URL.
  // The seed only applies to free-form lists — search-flow lists ignore it.
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState(prefillUrlParam ?? "");
  const [note, setNote] = useState("");
  const trimmedTitle = title.trim();
  const canSubmitFreeForm = trimmedTitle.length >= 1 && trimmedTitle.length <= 500;

  // Link preview (date_idea / trip): debounce the URL and resolve to a stable
  // http(s) URL before firing. TanStack Query auto-cancels in-flight requests
  // via `signal` when the key changes.
  const debouncedUrl = useDebouncedQuery(url, 300);
  const normalizedUrl = normalizeHttpUrl(debouncedUrl);
  const previewEnabled = !!token && !!listType && !isSearchType && normalizedUrl !== null;
  const previewQuery = useQuery<LinkPreviewResponse, Error>({
    queryKey: ["link-preview", normalizedUrl ?? ""],
    queryFn: ({ signal }) => fetchLinkPreview(normalizedUrl as string, token, signal),
    enabled: previewEnabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Search field (movie / tv / book).
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedQuery(query, 300);
  const trimmedDebounced = debouncedQuery.trim();
  const searchEnabled = !!token && !!listType && isSearchType && trimmedDebounced.length >= 2;

  const searchQuery = useQuery<MediaSearchResponse | BookSearchResponse, Error>({
    queryKey: ["search", listType ?? "", trimmedDebounced],
    queryFn: ({ signal }) => {
      if (listType === "book") return searchBooks(trimmedDebounced, token, signal);
      return searchMedia(listType as MediaSearchType, trimmedDebounced, token, signal);
    },
    enabled: searchEnabled,
    staleTime: 30_000,
  });

  const [pendingId, setPendingId] = useState<string | null>(null);

  const addMutation = useMutation<unknown, Error, { resultId: string; body: CreateItemRequest }>({
    mutationFn: ({ body }) => {
      if (!id) throw new Error("missing list id");
      return createItem(id, body, token);
    },
    onMutate: ({ resultId }) => {
      setPendingId(resultId);
    },
    onSuccess: async () => {
      haptics.medium();
      if (id) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byListFiltered(id, false) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        ]);
      }
      router.back();
    },
    onError: (e) => {
      setPendingId(null);
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't add item",
        tone: "danger",
      });
    },
  });

  if (!id) {
    return (
      <View style={styles.root}>
        <Text>Missing list id.</Text>
      </View>
    );
  }

  // The list query is loading — show a placeholder rather than picking a UI
  // before we know the list's type.
  if (listQuery.isPending) {
    return (
      <View style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      </View>
    );
  }

  const onAddMedia = (r: MediaResult) => {
    const body: CreateItemRequest = {
      title: r.title,
      metadata: buildMediaMetadata(r),
    };
    addMutation.mutate({ resultId: r.id, body });
  };

  const onAddBook = (r: BookResult) => {
    const body: CreateItemRequest = {
      title: r.title,
      metadata: buildBookMetadata(r),
    };
    addMutation.mutate({ resultId: r.id, body });
  };

  const submitFreeForm = () => {
    const trimmedUrl = url.trim();
    const trimmedNote = note.trim();
    // Only attach metadata when the preview matches the URL the user is
    // actually submitting — the debounced fetch could be stale or have failed.
    const preview =
      previewQuery.data?.preview && normalizedUrl !== null && trimmedUrl === debouncedUrl.trim()
        ? previewQuery.data.preview
        : null;
    const metadata = preview ? buildLinkPreviewMetadata(preview) : undefined;
    const body: CreateItemRequest = {
      title: trimmedTitle,
      ...(trimmedUrl.length > 0 ? { url: trimmedUrl } : {}),
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      ...(metadata ? { metadata } : {}),
    };
    addMutation.mutate({ resultId: "free-form", body });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Cancel" onPress={() => router.back()}>
          <Text style={styles.headerGlyph}>✕</Text>
        </IconButton>
        <Text variant="heading">Add item</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isSearchType ? (
        <SearchFlow
          listType={listType as "movie" | "tv" | "book"}
          query={query}
          onChangeQuery={setQuery}
          searchQuery={searchQuery}
          trimmedDebounced={trimmedDebounced}
          pendingId={pendingId}
          onAddMedia={onAddMedia}
          onAddBook={onAddBook}
        />
      ) : (
        <FreeFormFlow
          title={title}
          onChangeTitle={setTitle}
          url={url}
          onChangeUrl={setUrl}
          note={note}
          onChangeNote={setNote}
          canSubmit={canSubmitFreeForm}
          loading={addMutation.isPending}
          onSubmit={submitFreeForm}
          preview={previewQuery.data?.preview ?? null}
          previewLoading={previewQuery.isFetching}
          previewFailed={!!previewQuery.error}
          previewActive={previewEnabled}
        />
      )}
    </View>
  );
}

function buildMediaMetadata(r: MediaResult): CreateItemRequest["metadata"] {
  const meta: Record<string, unknown> = { source: "tmdb", sourceId: r.id };
  if (r.posterUrl) meta.posterUrl = r.posterUrl;
  if (typeof r.year === "number") meta.year = r.year;
  if (typeof r.runtimeMinutes === "number") meta.runtimeMinutes = r.runtimeMinutes;
  if (r.overview) meta.overview = r.overview;
  return meta;
}

function buildBookMetadata(r: BookResult): CreateItemRequest["metadata"] {
  const meta: Record<string, unknown> = { source: "google_books", sourceId: r.id };
  if (r.coverUrl) meta.coverUrl = r.coverUrl;
  if (r.authors.length > 0) meta.authors = r.authors;
  if (typeof r.year === "number") meta.year = r.year;
  if (typeof r.pageCount === "number") meta.pageCount = r.pageCount;
  if (r.description) meta.description = r.description;
  return meta;
}

// Only the keys that `placeMetadataSchema` (apps/backend/src/routes/v1/items.ts)
// accepts; passing anything else with a `.strict()` validator would 400.
function buildLinkPreviewMetadata(p: LinkPreview): CreateItemRequest["metadata"] {
  const meta: Record<string, unknown> = { source: "link_preview", sourceId: p.finalUrl };
  if (p.image) meta.image = p.image;
  if (p.siteName) meta.siteName = p.siteName;
  if (p.title) meta.title = p.title;
  if (p.description) meta.description = p.description;
  return meta;
}

// Returns a normalised http(s) URL (trimmed, single-pass through `URL`) or
// null when the input doesn't parse or isn't http(s). Used to gate the
// link-preview fetch so we never hit `/v1/link-preview?url=` with garbage.
function normalizeHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

interface SearchFlowProps {
  listType: "movie" | "tv" | "book";
  query: string;
  onChangeQuery: (v: string) => void;
  searchQuery: ReturnType<typeof useQuery<MediaSearchResponse | BookSearchResponse, Error>>;
  trimmedDebounced: string;
  pendingId: string | null;
  onAddMedia: (r: MediaResult) => void;
  onAddBook: (r: BookResult) => void;
}

function SearchFlow({
  listType,
  query,
  onChangeQuery,
  searchQuery,
  trimmedDebounced,
  pendingId,
  onAddMedia,
  onAddBook,
}: SearchFlowProps) {
  const placeholder =
    listType === "book" ? "Search books" : listType === "tv" ? "Search TV shows" : "Search movies";

  const data = searchQuery.data;
  const showPrompt = trimmedDebounced.length < 2;
  const showLoading = !showPrompt && searchQuery.isFetching && !data;
  const showError = !showPrompt && !!searchQuery.error;

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Card style={styles.searchCard} elevated>
        <TextInput
          testID="add-item-search"
          value={query}
          onChangeText={onChangeQuery}
          placeholder={placeholder}
          placeholderTextColor={tokens.text.muted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
          style={styles.input}
        />
      </Card>

      {showPrompt ? (
        <Text tone="secondary" style={styles.helper} testID="add-item-search-prompt">
          Type at least 2 characters to search.
        </Text>
      ) : null}

      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : null}

      {showError ? (
        <Text tone="danger" style={styles.helper} testID="add-item-search-error">
          Search failed. Try again.
        </Text>
      ) : null}

      {data && listType === "book" && "results" in data
        ? (data as BookSearchResponse).results.map((r) => (
            <SearchResultRow
              key={r.id}
              id={r.id}
              title={r.title}
              year={r.year}
              imageUrl={r.coverUrl}
              subtitle={r.authors.length > 0 ? r.authors.join(", ") : null}
              loading={pendingId === r.id}
              disabled={pendingId !== null && pendingId !== r.id}
              onAdd={() => onAddBook(r)}
            />
          ))
        : null}

      {data && listType !== "book" && "results" in data
        ? (data as MediaSearchResponse).results.map((r) => (
            <SearchResultRow
              key={r.id}
              id={r.id}
              title={r.title}
              year={r.year}
              imageUrl={r.posterUrl}
              subtitle={r.overview}
              loading={pendingId === r.id}
              disabled={pendingId !== null && pendingId !== r.id}
              onAdd={() => onAddMedia(r)}
            />
          ))
        : null}

      {data && !showPrompt && !showLoading && data.results.length === 0 ? (
        <Text tone="secondary" style={styles.helper} testID="add-item-search-empty">
          No matches.
        </Text>
      ) : null}
    </ScrollView>
  );
}

interface FreeFormFlowProps {
  title: string;
  onChangeTitle: (v: string) => void;
  url: string;
  onChangeUrl: (v: string) => void;
  note: string;
  onChangeNote: (v: string) => void;
  canSubmit: boolean;
  loading: boolean;
  onSubmit: () => void;
  preview: LinkPreview | null;
  previewLoading: boolean;
  previewFailed: boolean;
  /** True when a parseable http(s) URL is in flight (debounced). */
  previewActive: boolean;
}

function FreeFormFlow({
  title,
  onChangeTitle,
  url,
  onChangeUrl,
  note,
  onChangeNote,
  canSubmit,
  loading,
  onSubmit,
  preview,
  previewLoading,
  previewFailed,
  previewActive,
}: FreeFormFlowProps) {
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Card style={styles.card} elevated>
        <View style={styles.field}>
          <Text variant="label" tone="secondary">
            Title
          </Text>
          <TextInput
            testID="add-item-title"
            value={title}
            onChangeText={onChangeTitle}
            placeholder="What is it?"
            placeholderTextColor={tokens.text.muted}
            autoFocus
            maxLength={500}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary">
            URL (optional)
          </Text>
          <TextInput
            testID="add-item-url"
            value={url}
            onChangeText={onChangeUrl}
            placeholder="https://"
            placeholderTextColor={tokens.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={2048}
            style={styles.input}
          />
          <LinkPreviewSection
            preview={preview}
            loading={previewLoading}
            failed={previewFailed}
            active={previewActive}
          />
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary">
            Note (optional)
          </Text>
          <TextInput
            testID="add-item-note"
            value={note}
            onChangeText={onChangeNote}
            placeholder="Anything to remember?"
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={1000}
            style={[styles.input, styles.inputMultiline]}
          />
        </View>

        <Button
          testID="add-item-submit"
          label="Add"
          size="lg"
          disabled={!canSubmit || loading}
          loading={loading}
          onPress={onSubmit}
        />
      </Card>
    </ScrollView>
  );
}

interface LinkPreviewSectionProps {
  preview: LinkPreview | null;
  loading: boolean;
  failed: boolean;
  active: boolean;
}

function LinkPreviewSection({ preview, loading, failed, active }: LinkPreviewSectionProps) {
  if (!active) return null;
  if (loading && !preview) {
    return (
      <View style={styles.previewLoading} testID="link-preview-loading">
        <ActivityIndicator color={tokens.accent.default} size="small" />
        <Text tone="secondary" variant="caption">
          Fetching preview…
        </Text>
      </View>
    );
  }
  if (failed) {
    return (
      <Text
        tone="secondary"
        variant="caption"
        testID="link-preview-error"
        style={styles.previewHelper}
      >
        Couldn't fetch preview.
      </Text>
    );
  }
  if (!preview) return null;
  const heading = preview.title ?? preview.siteName ?? preview.finalUrl;
  return (
    <View testID="link-preview-card" style={styles.previewCard}>
      {preview.image ? (
        <Image
          source={{ uri: preview.image }}
          style={styles.previewImage}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.previewImage, styles.previewImagePlaceholder]}>
          <Text tone="muted">🔗</Text>
        </View>
      )}
      <View style={styles.previewBody}>
        {preview.siteName ? (
          <Text tone="secondary" variant="caption" numberOfLines={1}>
            {preview.siteName}
          </Text>
        ) : null}
        <Text variant="body" numberOfLines={2} testID="link-preview-title">
          {heading}
        </Text>
      </View>
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
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
  searchCard: { paddingVertical: tokens.space.sm },
  card: { gap: tokens.space.lg },
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
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  helper: { textAlign: "center", paddingVertical: tokens.space.lg },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xl },
  previewCard: {
    flexDirection: "row",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.canvas,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  previewImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  previewBody: { flex: 1, gap: 2, justifyContent: "center" },
  previewLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
  },
  previewHelper: { paddingVertical: tokens.space.sm },
});
