import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  BookResult,
  BookSearchResponse,
  CreateItemRequest,
  Item,
  ItemContent,
  ItemKind,
  LinkPreview,
  LinkPreviewResponse,
  ListRowsResponse,
  MediaResult,
  MediaSearchResponse,
  MediaSearchType,
} from "@workshop/shared";
import { linkPreviewToItemContent } from "@workshop/shared/linkContent";
import { listKind } from "@workshop/shared/listKinds";
import {
  Button,
  haptics,
  Icon,
  IconButton,
  interaction,
  layout,
  normalizeExternalUrl,
  Screen,
  ScreenHeader,
  SearchResultRow,
  SectionHeader,
  Skeleton,
  screenColumnStyle,
  TagEditor,
  Text,
  TextField,
  tokens,
  useToast,
  withTagDraft,
} from "@workshop/ui";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  type TextInputInstance,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { archiveItem, createItem, fetchItems } from "../../../../../src/api/items";
import { fetchLinkPreview } from "../../../../../src/api/linkPreview";
import { fetchListDetail, fetchListTags } from "../../../../../src/api/lists";
import { searchBooks, searchMedia } from "../../../../../src/api/search";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { useDebouncedQuery } from "../../../../../src/hooks/useDebouncedQuery";
import { onListResultIds, titleKey } from "../../../../../src/lib/duplicates";
import { FAILURE_TOAST_KEY, failureMessage } from "../../../../../src/lib/errorCopy";
import { goBack } from "../../../../../src/lib/goBack";
import { forgetItemAdded, noteItemAdded } from "../../../../../src/lib/recentlyAdded";
import {
  noteFromSharedText,
  rememberShareList,
  titleFromSharedText,
} from "../../../../../src/lib/sharePayload";
import { useEscapeToClose } from "../../../../../src/lib/shortcuts/useShortcuts";

/** How long Return waits for a pasted link's preview before adding anyway. */
const PREVIEW_WAIT_MS = 2500;

interface Added {
  id: string;
  title: string;
}

/**
 * Quick add (2.4–2.6). The surface stays open: each add clears the field,
 * keeps focus and shows the item in an "Added" list beneath, where it can be
 * undone. Closing returns to the list, which scrolls to and highlights what
 * was added (`recentlyAdded`).
 *
 * - Plain and link lists: one line. A title, or a pasted link whose preview
 *   supplies the title. Link, note and tags live behind "Details". Return
 *   adds and keeps going.
 * - Movie / TV / book lists: search first. Results already on the list say
 *   "On list"; no match (or a failed search) offers `Add “query” anyway`.
 */
export default function AddItem() {
  const params = useLocalSearchParams<{
    id: string;
    prefillUrl?: string;
    prefillText?: string;
    from?: string;
  }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  const prefillUrl =
    (Array.isArray(params.prefillUrl) ? params.prefillUrl[0] : params.prefillUrl) ?? "";
  const prefillText = (
    (Array.isArray(params.prefillText) ? params.prefillText[0] : params.prefillText) ?? ""
  ).trim();
  // Opened from the share picker or a new list made for a share (4.4): the
  // first add saves the share, so it lands on the list with "Added to …".
  const fromShare = (Array.isArray(params.from) ? params.from[0] : params.from) === "share";
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const itemsKey = queryKeys.items.byList(id);

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id),
    queryFn: () => fetchListDetail(id, token),
    enabled: !!token && !!id,
  });
  const listTagsQuery = useQuery({
    queryKey: queryKeys.tags.byList(id),
    queryFn: () => fetchListTags(id, token),
    enabled: !!token && !!id,
  });
  // The list's rows, for "On list" and duplicate hints. Usually warm.
  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchItems(id, token),
    enabled: !!token && !!id,
  });
  const existing = itemsQuery.data
    ? [...itemsQuery.data.open, ...itemsQuery.data.inbox, ...itemsQuery.data.completed]
    : [];

  const list = listQuery.data?.list;
  const itemKind = list?.itemKind ?? null;
  // How this kind of list takes a row (`@workshop/shared/listKinds`).
  const kind = listKind(itemKind);
  const isSearchKind = kind.add.mode === "search";
  const isSyncOnly = kind.add.mode === "sync_only";

  const [added, setAdded] = useState<Added[]>([]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const addMutation = useMutation<Item, Error, { key: string; body: CreateItemRequest }>({
    mutationFn: async ({ body }) => (await createItem(id, body, token)).item,
    onMutate: ({ key }) => {
      // On the tap: an add is a commit (`light`); saving a share is `success`.
      if (fromShare) haptics.success();
      else haptics.light();
      setPendingKey(key);
    },
    onSuccess: (item, { body }) => {
      noteItemAdded(id, item.id);
      if (fromShare) {
        void rememberShareList(id);
        showToast({ key: "share-saved", message: `Added to ${list?.name ?? "the list"}` });
      }
      setAdded((prev) => [{ id: item.id, title: item.title }, ...prev]);
      // New items land at the top of the list; show it there now.
      queryClient.setQueryData<ListRowsResponse>(itemsKey, (d) =>
        d && !d.open.some((i) => i.id === item.id) ? { ...d, open: [item, ...d.open] } : d,
      );
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      if (body.tags?.length) queryClient.invalidateQueries({ queryKey: queryKeys.tags.byList(id) });
      if (fromShare) goBack(`/list/${id}`);
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't add that."),
        tone: "danger",
      });
    },
    onSettled: () => setPendingKey(null),
  });

  const undoMutation = useMutation<unknown, Error, Added>({
    mutationFn: (a) => archiveItem(a.id, token),
    onMutate: (a) => {
      haptics.light();
      forgetItemAdded(id, a.id);
      setAdded((prev) => prev.filter((x) => x.id !== a.id));
      queryClient.setQueryData<ListRowsResponse>(itemsKey, (d) =>
        d ? { ...d, open: d.open.filter((i) => i.id !== a.id) } : d,
      );
    },
    onError: (e, a) => {
      noteItemAdded(id, a.id);
      setAdded((prev) => [a, ...prev]);
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't undo that."),
        tone: "danger",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });

  const close = () => goBack(`/list/${id}`);
  const isFocused = useIsFocused();
  useEscapeToClose(close, isFocused);
  const header = (
    <ScreenHeader
      leading="close"
      leadingLabel="Done adding"
      leadingTestID="add-item-cancel"
      onLeadingPress={close}
      eyebrow={list?.name}
      title={kind.add.title}
      trailing={
        list && kind.add.bulk ? (
          <Button
            label="Paste many"
            variant="ghost"
            size="md"
            testID="add-item-bulk-link"
            onPress={() => router.push(`/list/${id}/add-bulk`)}
          />
        ) : null
      }
    />
  );

  if (!id) {
    return (
      <Screen style={styles.root}>
        <ScreenHeader leading="close" leadingLabel="Close" onLeadingPress={() => goBack("/")} />
        <View style={styles.body}>
          <Text tone="secondary">This link doesn't point at a list. Pick one from your lists.</Text>
          <Button label="Go to your lists" variant="secondary" onPress={() => goBack("/")} />
        </View>
      </Screen>
    );
  }

  if (listQuery.isPending) {
    return (
      <Screen style={styles.root}>
        {header}
        <View style={[styles.body, screenColumnStyle]} accessibilityLabel="Loading" aria-busy>
          <Skeleton.Block height={tokens.hit} radius={tokens.radius.md} />
        </View>
      </Screen>
    );
  }

  const addedList = <AddedList items={added} onUndo={(a) => undoMutation.mutate(a)} />;

  // An album shelf only fills from its playlist; a direct link here (or a
  // share aimed at it) explains that instead of offering a form that can't save.
  if (isSyncOnly) {
    const source = kind.syncSources[0];
    return (
      <Screen style={styles.root}>
        {header}
        <View style={[styles.body, screenColumnStyle]} testID="add-item-sync-only">
          <Text tone="secondary">
            {`${kind.empty.description} New ${kind.noun.many} arrive when it syncs.`}
          </Text>
          <Button
            label={source ? "Open list settings" : "Back to the list"}
            variant="secondary"
            onPress={() =>
              source ? router.replace(`/list/${id}/settings`) : goBack(`/list/${id}`)
            }
            testID="add-item-sync-only-settings"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.root}>
      {header}
      {isSearchKind ? (
        <SearchFlow
          itemKind={itemKind as "movie" | "tv" | "book"}
          initialQuery={prefillText ? titleFromSharedText(prefillText) : ""}
          token={token}
          existing={existing}
          pendingKey={pendingKey}
          onAdd={(key, body) => addMutation.mutate({ key, body })}
          footer={addedList}
        />
      ) : (
        <QuickAdd
          itemKind={itemKind}
          token={token}
          existing={existing}
          listTags={(listTagsQuery.data?.tags ?? []).map((t) => t.tag)}
          initialText={prefillUrl || titleFromSharedText(prefillText)}
          initialNote={noteFromSharedText(prefillText, !!prefillUrl)}
          onAdd={(body) => addMutation.mutateAsync({ key: "quick", body })}
          footer={addedList}
        />
      )}
    </Screen>
  );
}

/* ------------------------------ quick add -------------------------------- */

interface QuickAddProps {
  itemKind: ItemKind | null;
  token: string | null;
  existing: readonly Item[];
  listTags: string[];
  initialText: string;
  initialNote: string;
  onAdd: (body: CreateItemRequest) => Promise<Item>;
  footer: React.ReactNode;
}

function QuickAdd({
  itemKind,
  token,
  existing,
  listTags,
  initialText,
  initialNote,
  onAdd,
  footer,
}: QuickAddProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInputInstance>(null);
  const [text, setText] = useState(initialText);
  const [detailsOpen, setDetailsOpen] = useState(initialNote.length > 0);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailUrl, setDetailUrl] = useState("");
  const [note, setNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A link pasted into the one line is the item's link; its preview names it.
  const pastedUrl = singleUrl(text);
  const urlSource = pastedUrl ?? normalizeHttpUrl(detailUrl);
  const debouncedUrl = useDebouncedQuery(urlSource ?? "", 300);
  const previewKey = ["link-preview", debouncedUrl] as const;
  const previewQuery = useQuery<LinkPreviewResponse, Error>({
    queryKey: previewKey,
    queryFn: ({ signal }) => fetchLinkPreview(debouncedUrl, token, signal),
    enabled: !!token && debouncedUrl.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const preview =
    urlSource && debouncedUrl === urlSource ? (previewQuery.data?.preview ?? null) : null;

  const typedTitle = pastedUrl ? detailTitle.trim() : text.trim();
  const duplicate =
    !pastedUrl &&
    typedTitle.length > 0 &&
    existing.some((i) => titleKey(i.title) === titleKey(typedTitle));
  const canSubmit = (pastedUrl !== null || typedTitle.length > 0) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let resolved: LinkPreview | null = preview;
      if (urlSource && !resolved) {
        // Return right after pasting: give the preview a moment to name it.
        resolved = await Promise.race([
          queryClient
            .fetchQuery({
              queryKey: ["link-preview", urlSource],
              queryFn: ({ signal }) => fetchLinkPreview(urlSource, token, signal),
              staleTime: 5 * 60_000,
            })
            .then((r) => r.preview)
            .catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), PREVIEW_WAIT_MS)),
        ]);
      }
      const title = clampTitle(
        typedTitle || resolved?.title || hostOf(urlSource ?? "") || (urlSource ?? ""),
      );
      const kind: ItemKind = itemKind ?? (urlSource ? "link" : "plain");
      const trimmedNote = note.trim();
      const allTags = withTagDraft(tags, tagDraft);
      // Plain items can carry a URL, but their content must stay empty.
      const content: ItemContent | undefined =
        kind === "link" && resolved ? linkPreviewToItemContent(resolved) : undefined;
      await onAdd({
        kind,
        title,
        ...(urlSource ? { url: urlSource } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(content ? { content } : {}),
        ...(allTags.length > 0 ? { tags: allTags } : {}),
      });
      setText("");
      setDetailTitle("");
      setDetailUrl("");
      setNote("");
      setTags([]);
      setTagDraft("");
    } catch {
      // The mutation reported it; keep what was typed so nothing is lost.
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const placeholder =
    itemKind === "link" ? "Add an idea or paste a link" : "Add an item or paste a link";

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={[styles.body, screenColumnStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={tokens.space.lg}
    >
      <TextField
        ref={inputRef}
        testID="add-item-title"
        accessibilityLabel="New item"
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        autoFocus
        maxLength={2048}
        returnKeyType="done"
        enterKeyHint="enter"
        // Keep the keyboard up: Return adds and the next item follows.
        submitBehavior="submit"
        onSubmitEditing={() => void submit()}
        hint={duplicate ? "Already on the list" : undefined}
        trailing={
          <IconButton
            icon="plus"
            iconTone={canSubmit ? "accent" : "muted"}
            accessibilityLabel="Add"
            onPress={() => void submit()}
            disabled={!canSubmit}
            busy={submitting}
            testID="add-item-submit"
          />
        }
      />

      {urlSource ? (
        <LinkPreviewSection
          preview={preview}
          loading={previewQuery.isFetching}
          failed={!!previewQuery.error}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        aria-expanded={detailsOpen}
        onPress={() => setDetailsOpen((o) => !o)}
        testID="add-item-details-toggle"
        style={({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => [
          styles.disclosure,
          hovered && { backgroundColor: interaction.hover },
          pressed && { backgroundColor: interaction.pressed },
        ]}
      >
        <Text variant="label" tone="secondary">
          {detailsOpen ? "Hide details" : "Details"}
        </Text>
        <Icon
          name="chevron-down"
          size={14}
          tone="muted"
          style={detailsOpen ? styles.chevronUp : undefined}
        />
      </Pressable>

      {detailsOpen ? (
        <View style={styles.details}>
          {pastedUrl ? (
            <TextField
              label="Title"
              testID="add-item-detail-title"
              value={detailTitle}
              onChangeText={setDetailTitle}
              placeholder={preview?.title ?? "From the link"}
              maxLength={500}
            />
          ) : (
            <TextField
              label="Link"
              testID="add-item-url"
              value={detailUrl}
              onChangeText={setDetailUrl}
              placeholder="https://"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              maxLength={2048}
            />
          )}
          <TextField
            label="Note"
            testID="add-item-note"
            value={note}
            onChangeText={setNote}
            placeholder="Anything to remember?"
            multiline
            maxLength={1000}
          />
          <View style={styles.tagsField}>
            <Text variant="label" tone="secondary">
              Tags
            </Text>
            <TagEditor
              tags={tags}
              listTags={listTags}
              onChange={setTags}
              draft={tagDraft}
              onDraftChange={setTagDraft}
              testIDPrefix="add-item-tag"
            />
          </View>
        </View>
      ) : null}

      {footer}
    </KeyboardAwareScrollView>
  );
}

/* ------------------------------ search add ------------------------------- */

interface SearchFlowProps {
  itemKind: "movie" | "tv" | "book";
  /** A shared title to search for straight away (4.4). */
  initialQuery: string;
  token: string | null;
  existing: readonly Item[];
  pendingKey: string | null;
  onAdd: (key: string, body: CreateItemRequest) => void;
  footer: React.ReactNode;
}

function SearchFlow({
  itemKind,
  initialQuery,
  token,
  existing,
  pendingKey,
  onAdd,
  footer,
}: SearchFlowProps) {
  const inputRef = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebouncedQuery(query, 300).trim();
  const searchQuery = useQuery<MediaSearchResponse | BookSearchResponse, Error>({
    queryKey: ["search", itemKind, debounced],
    queryFn: ({ signal }) =>
      itemKind === "book"
        ? searchBooks(debounced, token, signal)
        : searchMedia(itemKind as MediaSearchType, debounced, token, signal),
    enabled: !!token && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });

  const placeholder =
    itemKind === "book" ? "Search books" : itemKind === "tv" ? "Search TV shows" : "Search movies";
  const typed = query.trim();
  const settled = debounced === typed && typed.length >= 2;
  const data = settled ? searchQuery.data : undefined;
  const results = data?.results ?? [];
  const showLoading = typed.length >= 2 && (!settled || (searchQuery.isFetching && !data));
  const failed = settled && !!searchQuery.error;
  const noMatches = settled && !!data && results.length === 0;

  const add = (key: string, body: CreateItemRequest) => {
    onAdd(key, body);
    setQuery("");
    inputRef.current?.focus();
    // Web: Return blurs the field after this handler runs; take it back.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onListIds = onListResultIds(results, existing);
  const onList = (r: { id: string }) => onListIds.has(r.id);

  // Return adds the top result, like Return in quick add (5, critique: it
  // did nothing and dropped focus). With no results it adds the typed name.
  const submitTop = () => {
    if (failed || noMatches) {
      if (typed.length > 0) add("anyway", { kind: itemKind, title: clampTitle(typed) });
      return;
    }
    if (!data) return;
    if (itemKind === "book") {
      const top = (data as BookSearchResponse).results.find((r) => !onList(r));
      if (top) add(top.id, { kind: "book", title: top.title, content: buildBookContent(top) });
      return;
    }
    const top = (data as MediaSearchResponse).results.find((r) => !onList(r));
    if (top) add(top.id, { kind: itemKind, title: top.title, content: buildMediaContent(top) });
  };

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={[styles.body, screenColumnStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={tokens.space.lg}
    >
      <TextField
        ref={inputRef}
        variant="search"
        testID="add-item-search"
        accessibilityLabel={placeholder}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery("")}
        placeholder={placeholder}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={200}
        returnKeyType="done"
        submitBehavior="submit"
        blurOnSubmit={false}
        onSubmitEditing={submitTop}
        accessibilityHint="Return adds the top result"
      />

      {typed.length < 2 ? (
        <Text tone="muted" style={styles.helper} testID="add-item-search-prompt">
          Type at least 2 characters to search.
        </Text>
      ) : null}

      {showLoading ? (
        <View
          style={styles.resultSkeletons}
          accessibilityLabel="Searching"
          accessibilityRole="progressbar"
          testID="add-item-search-loading"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton.Block key={i} height={RESULT_ROW_HEIGHT} radius={tokens.radius.md} />
          ))}
        </View>
      ) : null}

      {failed ? (
        <Text
          tone="secondary"
          style={styles.helper}
          testID="add-item-search-error"
          accessibilityRole="alert"
        >
          Search isn't working right now. You can still add it by name.
        </Text>
      ) : null}
      {noMatches ? (
        <Text tone="secondary" style={styles.helper} testID="add-item-search-empty">
          No matches. Check the spelling, or add it by name.
        </Text>
      ) : null}

      {data && itemKind === "book"
        ? (data as BookSearchResponse).results.map((r) => (
            <SearchResultRow
              key={r.id}
              id={r.id}
              title={r.title}
              year={r.year}
              imageUrl={r.coverUrl}
              subtitle={r.authors.length > 0 ? r.authors.join(", ") : null}
              loading={pendingKey === r.id}
              onList={onList(r)}
              onAdd={() =>
                add(r.id, { kind: "book", title: r.title, content: buildBookContent(r) })
              }
            />
          ))
        : null}
      {data && itemKind !== "book"
        ? (data as MediaSearchResponse).results.map((r) => (
            <SearchResultRow
              key={r.id}
              id={r.id}
              title={r.title}
              year={r.year}
              imageUrl={r.posterUrl}
              subtitle={r.overview}
              loading={pendingKey === r.id}
              onList={onList(r)}
              onAdd={() =>
                add(r.id, { kind: itemKind, title: r.title, content: buildMediaContent(r) })
              }
            />
          ))
        : null}

      {failed || noMatches ? (
        <Button
          label={`Add “${clampTitle(typed)}” anyway`}
          variant="secondary"
          testID="add-item-search-anyway"
          loading={pendingKey === "anyway"}
          onPress={() => add("anyway", { kind: itemKind, title: clampTitle(typed) })}
        />
      ) : null}

      {footer}
    </KeyboardAwareScrollView>
  );
}

/* ------------------------------- pieces ---------------------------------- */

/** The adds of this visit, newest first; each can be taken back. */
function AddedList({ items, onUndo }: { items: Added[]; onUndo: (a: Added) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.added} testID="add-item-added" accessibilityLiveRegion="polite">
      <SectionHeader title="Added" inset={false} first />
      {items.slice(0, 8).map((a) => (
        <View key={a.id} style={styles.addedRow} testID={`add-item-added-${a.id}`}>
          <Icon name="check" size={14} tone="secondary" />
          <Text numberOfLines={1} style={styles.addedTitle}>
            {a.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Undo adding ${a.title}`}
            onPress={() => onUndo(a)}
            testID={`add-item-undo-${a.id}`}
            style={({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => [
              styles.undo,
              hovered && { backgroundColor: interaction.hover },
              pressed && { backgroundColor: interaction.pressed },
            ]}
          >
            <Text variant="label" tone="muted">
              Undo
            </Text>
          </Pressable>
        </View>
      ))}
      {items.length > 8 ? (
        <Text variant="caption" tone="muted">
          and {items.length - 8} more
        </Text>
      ) : null}
    </View>
  );
}

function LinkPreviewSection({
  preview,
  loading,
  failed,
}: {
  preview: LinkPreview | null;
  loading: boolean;
  failed: boolean;
}) {
  if (loading && !preview) {
    return (
      <View style={styles.previewLoading} testID="link-preview-loading">
        <ActivityIndicator color={tokens.accent.default} size="small" aria-hidden />
        <Text tone="secondary" variant="caption">
          Fetching preview…
        </Text>
      </View>
    );
  }
  if (failed && !preview) {
    return (
      <Text tone="muted" variant="caption" testID="link-preview-error">
        No preview for this link. It's saved as the address.
      </Text>
    );
  }
  if (!preview) return null;
  const heading = preview.title ?? preview.siteName ?? preview.finalUrl;
  const image = preview.imageProxy ?? preview.image;
  return (
    <View testID="link-preview-card" style={styles.previewCard}>
      {image ? (
        <Image
          source={{ uri: image }}
          style={styles.previewImage}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.previewImage, styles.previewImagePlaceholder]}>
          <Text style={styles.previewGlyph}>🔗</Text>
        </View>
      )}
      <View style={styles.previewBody}>
        {preview.siteName ? (
          <Text tone="secondary" variant="caption" numberOfLines={1}>
            {preview.siteName}
          </Text>
        ) : null}
        <Text numberOfLines={2} testID="link-preview-title">
          {heading}
        </Text>
      </View>
    </View>
  );
}

/* ------------------------------- helpers --------------------------------- */

function buildMediaContent(r: MediaResult): ItemContent {
  const c: Record<string, unknown> = { source: "tmdb", sourceId: r.id };
  if (r.posterUrl) c.posterUrl = r.posterUrl;
  if (typeof r.year === "number") c.year = r.year;
  if (typeof r.runtimeMinutes === "number") c.runtimeMinutes = r.runtimeMinutes;
  if (r.overview) c.overview = r.overview;
  return c;
}

function buildBookContent(r: BookResult): ItemContent {
  const c: Record<string, unknown> = { source: "google_books", sourceId: r.id };
  if (r.coverUrl) c.coverUrl = r.coverUrl;
  if (r.authors.length > 0) c.authors = r.authors;
  if (typeof r.year === "number") c.year = r.year;
  if (typeof r.pageCount === "number") c.pageCount = r.pageCount;
  if (r.description) c.description = r.description;
  return c;
}

/** Titles are one line of at most 500 characters (the server's rule). */
function clampTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 500);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A normalised http(s) URL, or null when the input isn't one. */
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

/** The line is exactly one link (no other words), normalised; else null. */
function singleUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  return normalizeHttpUrl(t) ?? (/^www\.\S+\.\S+/i.test(t) ? normalizeExternalUrl(t) : null);
}

// A `SearchResultRow`: its 84pt poster plus 12 padding and a 1pt border on
// each side, so the placeholders hold the results' place.
const RESULT_ROW_HEIGHT = 110;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: {
    paddingTop: tokens.space.md,
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
  helper: { textAlign: "center", paddingVertical: tokens.space.md },
  resultSkeletons: { gap: tokens.space.sm },
  disclosure: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: tokens.hit,
    paddingHorizontal: tokens.space.sm,
    marginLeft: -tokens.space.sm,
    borderRadius: tokens.radius.md,
  },
  chevronUp: { transform: [{ rotate: "180deg" }] },
  details: { gap: tokens.space.lg },
  tagsField: { gap: tokens.space.xsm },
  added: {
    gap: tokens.space.xxs,
    paddingTop: tokens.space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
  },
  addedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.hit,
  },
  addedTitle: { flex: 1, color: tokens.text.secondary },
  undo: {
    minHeight: tokens.hit,
    minWidth: tokens.hit,
    paddingHorizontal: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
    marginRight: -tokens.space.md,
  },
  previewCard: {
    flexDirection: "row",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  previewImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  previewGlyph: { fontSize: tokens.font.size.xl, lineHeight: tokens.font.lineHeight.xl },
  previewBody: { flex: 1, gap: tokens.space.xxs, justifyContent: "center" },
  previewLoading: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
});
