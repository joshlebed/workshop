import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Item } from "@workshop/shared";
import {
  ActionSheet,
  alpha,
  Button,
  confirm,
  EmojiBadge,
  EmptyState,
  formatRelative,
  haptics,
  Icon,
  IconButton,
  interaction,
  normalizeExternalUrl,
  openExternalUrl,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  TagEditor,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  archiveItem,
  completeItem,
  fetchItem,
  uncompleteItem,
  updateItem,
  updateItemTags,
} from "../../../../../../src/api/items";
import { fetchListDetail, fetchListTags } from "../../../../../../src/api/lists";
import { useAuth } from "../../../../../../src/hooks/useAuth";
import { goBack } from "../../../../../../src/lib/goBack";
import {
  type DraftField,
  type DraftValues,
  draftFromServer,
  isDraftDirty,
  reconcileDraftField,
} from "../../../../../../src/lib/itemDraft";

const AUTOSAVE_DEBOUNCE_MS = 700;

/**
 * Per-item detail screen for movie / tv / book / link / plain items.
 * Album-shelf items open Spotify on row tap and never land here; leaderboard
 * (game) items have their own combined edit + leaderboard screen at
 * /list/:id/game/:itemId.
 *
 * Design moves vs the previous version:
 *   - No Card wrapper; the canvas is the surface. The list's color + emoji
 *     is the back affordance, so you always know which list you're inside.
 *   - Per-kind hero: poster/cover + metadata for media items, link-preview
 *     thumbnail for links, just-title for plain items.
 *   - Inline-edit title (no separate label) — the title IS the input.
 *   - Autosave on blur + debounce; the only manual control is "Done" on the
 *     keyboard. A subtle "Saved" indicator lives in the header.
 *   - Completion gets the primary slot when the `todo` module is on. Copy
 *     adapts per kind ("Mark watched" / "Mark read" / "Mark done").
 *   - Delete is one tap deeper, behind the header `⋯` menu + a confirm.
 *   - Multiplayer-first provenance footer at the bottom.
 */
export default function ItemDetail() {
  const params = useLocalSearchParams<{ id: string; itemId: string }>();
  const listId = Array.isArray(params.id) ? params.id[0] : params.id;
  const itemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const itemQuery = useQuery({
    queryKey: queryKeys.items.detail(itemId ?? ""),
    queryFn: () => fetchItem(itemId ?? "", token),
    enabled: !!token && !!itemId,
  });

  // The parent list is usually warm in the cache (the user just came from the
  // list screen), so this paints synchronously. Subscribing (rather than a
  // one-off cache read) means an item opened cold — a deep link, a reload —
  // still gets the list chip, members and the todo "Mark done" action once
  // the list loads (0.11).
  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(listId ?? ""),
    queryFn: () => fetchListDetail(listId ?? "", token),
    enabled: !!token && !!listId,
  });
  const parentList = listQuery.data?.list ?? null;
  const listMembers = listQuery.data?.members ?? [];

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  // The ⋯ ActionSheet runs the chosen action from its `onClosed` (0.13): an
  // Alert or a navigation fired while the sheet's Modal is still dismissing
  // can be lost on iOS.
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Drafts are seeded once per item id; afterwards a refetch only reaches a
  // field that is neither focused nor holding an unsaved edit (0.2). The old
  // effect copied every refetch into the inputs, so an autosave landing
  // mid-typing reset the field and dropped what was typed after it fired.
  const seededItemIdRef = useRef<string | null>(null);
  const serverDraftRef = useRef<DraftValues | null>(null);
  const focusedFieldRef = useRef<DraftField | null>(null);
  const serverItem = itemQuery.data?.item;
  useEffect(() => {
    if (!serverItem) return;
    const next = draftFromServer(serverItem);
    const prev = serverDraftRef.current;
    serverDraftRef.current = next;
    if (seededItemIdRef.current !== serverItem.id || !prev) {
      seededItemIdRef.current = serverItem.id;
      setTitle(next.title);
      setNote(next.note);
      setUrl(next.url);
      return;
    }
    const reconcile = (field: DraftField) => (draft: string) =>
      reconcileDraftField({
        field,
        draft,
        prevServer: prev[field],
        nextServer: next[field],
        focused: focusedFieldRef.current === field,
        normalizeUrl: normalizeExternalUrl,
      });
    setTitle(reconcile("title"));
    setNote(reconcile("note"));
    setUrl(reconcile("url"));
  }, [serverItem]);

  function invalidateItem() {
    if (!itemId || !listId) return Promise.resolve();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) }),
    ]);
  }

  const completeMutation = useMutation({
    mutationFn: (nextCompleted: boolean) =>
      nextCompleted ? completeItem(itemId ?? "", token) : uncompleteItem(itemId ?? "", token),
    onSuccess: async () => {
      haptics.medium();
      await invalidateItem();
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't update item",
        tone: "danger",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { title: string; note: string; url: string }) => {
      const trimmedTitle = payload.title.trim();
      const trimmedNote = payload.note.trim();
      const normalizedUrl = normalizeExternalUrl(payload.url);
      return updateItem(
        itemId ?? "",
        {
          title: trimmedTitle,
          note: trimmedNote.length === 0 ? null : trimmedNote,
          url: normalizedUrl,
        },
        token,
      );
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: async () => {
      await invalidateItem();
      setSaveStatus("saved");
    },
    onError: (e) => {
      setSaveStatus("idle");
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't save",
        tone: "danger",
      });
    },
  });

  // The list's in-use tags power the suggested-chip picker — tagging is
  // never a bare free-text field (spec §2.1). Suggestions refresh whenever
  // a tag edit lands so two members editing in parallel converge.
  const listTagsQuery = useQuery({
    queryKey: queryKeys.tags.byList(listId ?? ""),
    queryFn: () => fetchListTags(listId ?? "", token),
    enabled: !!token && !!listId,
  });

  const tagsMutation = useMutation({
    mutationFn: (tags: string[]) => updateItemTags(itemId ?? "", { tags }, token),
    onSuccess: async () => {
      haptics.light();
      await invalidateItem();
      if (listId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.tags.byList(listId) });
      }
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't update tags",
        tone: "danger",
      }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveItem(itemId ?? "", token),
    onSuccess: async () => {
      haptics.medium();
      if (listId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        ]);
      }
      goBack(`/list/${listId}`);
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't delete",
        tone: "danger",
      }),
  });

  // Debounced autosave. We compare against the server snapshot (not against
  // the previous draft) so an inflight save that finishes while the user
  // keeps typing doesn't re-snapshot stale state. The latest drafts and the
  // server snapshot live in refs so the unmount flush below sees them.
  const item = itemQuery.data?.item;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  const draftRef = useRef<DraftValues>({ title, note, url });
  draftRef.current = { title, note, url };
  const lastSubmittedRef = useRef<string | null>(null);

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const server = serverDraftRef.current;
    if (!server) return;
    const draft = draftRef.current;
    const nextTitle = draft.title.trim();
    if (nextTitle.length === 0 || nextTitle.length > 500) return;
    if (!isDraftDirty(draft, server, normalizeExternalUrl)) return;
    // The back button flushes and the unmount that follows flushes again;
    // don't send the same payload twice.
    const key = JSON.stringify(draft);
    if (key === lastSubmittedRef.current) return;
    lastSubmittedRef.current = key;
    saveMutationRef.current.mutate(draft, {
      onError: () => {
        lastSubmittedRef.current = null;
      },
    });
  }, []);

  useEffect(() => {
    if (!item) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const dirty = isDraftDirty({ title, note, url }, draftFromServer(item), normalizeExternalUrl);
    if (!dirty) {
      // Fade the "Saved" indicator out a moment after the last save resolves.
      if (saveStatus === "saved") {
        const t = setTimeout(() => setSaveStatus("idle"), 1800);
        return () => clearTimeout(t);
      }
      return;
    }
    const nextTitle = title.trim();
    if (nextTitle.length === 0 || nextTitle.length > 500) return;
    debounceRef.current = setTimeout(() => {
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [item, title, note, url, flushSave, saveStatus]);

  // Leaving the screen (back button, swipe back, browser back) must not drop
  // the last keystrokes still waiting on the debounce.
  useEffect(() => () => flushSave(), [flushSave]);

  const onFieldFocus = (field: DraftField) => () => {
    focusedFieldRef.current = field;
  };
  // Trim on blur, not while typing, then save right away.
  const onFieldBlur = (field: DraftField) => () => {
    if (focusedFieldRef.current === field) focusedFieldRef.current = null;
    if (field === "title") setTitle((v) => v.trim());
    if (field === "note") setNote((v) => v.trim());
    if (field === "url") setUrl((v) => v.trim());
    flushSave();
  };
  const onBack = () => {
    flushSave();
    goBack(`/list/${listId}`);
  };

  if (!itemId || !listId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing item id" />
      </Screen>
    );
  }

  if (itemQuery.isPending) {
    return (
      <Screen style={styles.root}>
        <ItemHeader parentList={parentList} onBack={onBack} />
        <ItemDetailSkeleton />
      </Screen>
    );
  }

  // Cached item stays on screen if a background refetch fails (0.9).
  if (!itemQuery.data) {
    return (
      <Screen style={styles.center}>
        <EmptyState
          title="Couldn't load this"
          description={itemQuery.error instanceof Error ? itemQuery.error.message : undefined}
          action={<Button label="Retry" variant="secondary" onPress={() => itemQuery.refetch()} />}
        />
      </Screen>
    );
  }

  const loadedItem = itemQuery.data.item;
  const view = describeItem(loadedItem);
  const listAccent = parentList ? listColorHex(parentList.color) : tokens.accent.default;
  const todoEnabled = parentList?.modules?.includes("todo") ?? false;
  const addedByMember = listMembers.find((m) => m.userId === loadedItem.addedBy);
  const completedByMember = loadedItem.completedBy
    ? listMembers.find((m) => m.userId === loadedItem.completedBy)
    : null;

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete "${loadedItem.title}"?`,
      message: "This removes it from the list.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) archiveMutation.mutate();
  };

  const onOpenUrl = () => {
    if (loadedItem.url) openExternalUrl(loadedItem.url);
  };

  return (
    <Screen style={styles.root}>
      <ItemHeader
        parentList={parentList}
        onBack={onBack}
        trailing={
          <>
            <SaveIndicator status={saveStatus} />
            <IconButton
              icon="more"
              iconTone="secondary"
              accessibilityLabel="More actions"
              onPress={() => setMenuOpen(true)}
              testID="item-more"
            />
          </>
        }
      />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <KindHero
          item={loadedItem}
          view={view}
          accent={listAccent}
          onOpenUrl={loadedItem.url ? onOpenUrl : undefined}
        />

        <TextField
          variant="bare"
          testID="item-title-input"
          accessibilityLabel="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          maxLength={500}
          onFocus={onFieldFocus("title")}
          onBlur={onFieldBlur("title")}
          returnKeyType="next"
          inputStyle={{
            ...styles.titleInput,
            ...(loadedItem.completed ? styles.titleInputCompleted : null),
          }}
          multiline
          scrollEnabled={false}
        />

        {view.hasUrlField ? (
          <UrlField
            value={url}
            onChange={setUrl}
            onFocus={onFieldFocus("url")}
            onBlur={onFieldBlur("url")}
            currentUrl={loadedItem.url}
          />
        ) : null}

        <NoteField
          value={note}
          onChange={setNote}
          onFocus={onFieldFocus("note")}
          onBlur={onFieldBlur("note")}
          placeholder={notePlaceholderFor(loadedItem, todoEnabled)}
        />

        <View style={styles.tagSection}>
          <SectionHeader title="Tags" />
          <TagEditor
            tags={loadedItem.tags ?? []}
            listTags={(listTagsQuery.data?.tags ?? []).map((t) => t.tag)}
            pending={tagsMutation.isPending}
            onChange={(next) => tagsMutation.mutate(next)}
          />
        </View>

        {todoEnabled ? (
          <View style={styles.primaryActionRow}>
            <Button
              testID="item-detail-complete"
              label={completionLabel(loadedItem)}
              variant={loadedItem.completed ? "secondary" : "primary"}
              size="lg"
              loading={completeMutation.isPending}
              onPress={() => completeMutation.mutate(!loadedItem.completed)}
              style={styles.primaryAction}
            />
          </View>
        ) : null}

        <Provenance
          item={loadedItem}
          addedByName={addedByMember?.displayName ?? null}
          completedByName={completedByMember?.displayName ?? null}
        />
      </KeyboardAwareScrollView>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        testID="item-menu"
        cancelTestID="item-menu-cancel"
        items={[
          !!loadedItem.url && {
            label: "Open link",
            icon: "external",
            detail: hostFromUrl(loadedItem.url),
            onPress: onOpenUrl,
            testID: "item-menu-open",
          },
          {
            label: "Delete item",
            icon: "trash",
            tone: "danger",
            onPress: () => void onDelete(),
            testID: "item-menu-delete",
          },
        ]}
      />
    </Screen>
  );
}

/* ------------------------------- subviews -------------------------------- */

interface ParentListHeaderInfo {
  name: string;
  emoji: string;
  color: string | null;
}

/**
 * Back to the parent list: the list's emoji badge + name sit beside the back
 * control, so you always know which list you're inside.
 */
function ItemHeader({
  parentList,
  onBack,
  trailing,
}: {
  parentList: ParentListHeaderInfo | null;
  onBack: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <ScreenHeader
      leading="back"
      onLeadingPress={onBack}
      leadingLabel={parentList ? `Back to ${parentList.name}` : "Back"}
      leadingTestID="item-back-to-list"
      titleAccessory={
        parentList ? (
          <EmojiBadge
            emoji={parentList.emoji}
            color={listColorHex(parentList.color)}
            size={24}
            shape="rounded"
          />
        ) : null
      }
      title={parentList?.name}
      trailing={trailing}
    />
  );
}

/** First-load placeholder shaped like the hero, title, link and note. */
function ItemDetailSkeleton() {
  return (
    <View style={styles.body} accessibilityLabel="Loading" aria-busy>
      <View style={styles.heroMedia}>
        <Skeleton.Block width={110} height={110} radius={tokens.radius.md} />
        <View style={styles.heroMeta}>
          <Skeleton.Block width="45%" height={12} />
          <Skeleton.Block width="90%" height={12} />
          <Skeleton.Block width="70%" height={12} />
        </View>
      </View>
      <Skeleton.Block width="75%" height={30} />
      <Skeleton.Block width="55%" height={16} />
      <Skeleton.Block width="40%" height={16} />
    </View>
  );
}

interface KindView {
  imageUrl?: string;
  placeholderGlyph: string;
  subline: string;
  eyebrow: string;
  hasUrlField: boolean;
}

interface KindHeroProps {
  item: Item;
  view: KindView;
  accent: string;
  onOpenUrl?: () => void;
}

/**
 * Top-of-screen hero whose shape depends on the item kind.
 * - Media (movie/tv/book): big poster + eyebrow ("MOVIE · 2014 · 169 min") +
 *   optional "Open ↗" when the item has a URL.
 * - Link: preview thumbnail + site name eyebrow + "Open ↗" affordance.
 * - Plain: just an emoji glyph in a tinted square, sized down — title
 *   carries the visual weight on its own line below.
 */
function KindHero({ item, view, accent, onOpenUrl }: KindHeroProps) {
  const isMedia = item.kind === "movie" || item.kind === "tv" || item.kind === "book";
  const isLink = item.kind === "link";
  const isPlain = item.kind === "plain";

  if (isPlain) {
    return (
      <View style={styles.heroPlain}>
        <EmojiBadge emoji={view.placeholderGlyph} color={accent} size={44} shape="rounded" />
        {view.eyebrow ? <Text variant="eyebrow">{view.eyebrow}</Text> : null}
      </View>
    );
  }

  const cover = view.imageUrl ? (
    <Image
      source={{ uri: view.imageUrl }}
      style={isMedia ? styles.heroPoster : styles.heroLinkImage}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View
      style={[
        isMedia ? styles.heroPoster : styles.heroLinkImage,
        styles.heroPlaceholder,
        { backgroundColor: alpha(accent, 0.15) },
      ]}
    >
      <Text style={styles.heroPlaceholderGlyph}>{view.placeholderGlyph}</Text>
    </View>
  );

  return (
    <View style={styles.heroMedia}>
      {cover}
      <View style={styles.heroMeta}>
        {view.eyebrow ? <Text variant="eyebrow">{view.eyebrow}</Text> : null}
        {view.subline ? (
          <Text variant="caption" tone="secondary" numberOfLines={4} style={styles.heroSubline}>
            {view.subline}
          </Text>
        ) : null}
        {onOpenUrl ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open link"
            onPress={onOpenUrl}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.openLink,
              hovered && styles.openLinkHovered,
              pressed && styles.openLinkPressed,
            ]}
            testID="item-open-link"
          >
            <Text variant="caption" style={[styles.openLinkText, { color: accent }]}>
              {isLink ? "Open page" : "Open"}
            </Text>
            <Icon name="external" size={14} color={accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface UrlFieldProps {
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  currentUrl: string | null;
}

function UrlField({ value, onChange, onFocus, onBlur, currentUrl }: UrlFieldProps) {
  const trimmed = value.trim();
  const showOpen = trimmed.length > 0 && normalizeExternalUrl(trimmed) === (currentUrl ?? "");
  return (
    <View style={styles.urlRow}>
      <TextField
        variant="bare"
        testID="item-url-input"
        accessibilityLabel="Link"
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Add a link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputMode="url"
        maxLength={2048}
        style={styles.urlField}
        inputStyle={styles.urlInput}
        trailing={
          showOpen ? (
            <IconButton
              icon="external"
              iconSize={16}
              iconTone="secondary"
              accessibilityLabel="Open link"
              onPress={() => openExternalUrl(currentUrl)}
              testID="item-url-open"
            />
          ) : null
        }
      />
    </View>
  );
}

interface NoteFieldProps {
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  placeholder: string;
}

function NoteField({ value, onChange, onFocus, onBlur, placeholder }: NoteFieldProps) {
  return (
    <View style={styles.noteRow}>
      <TextField
        variant="bare"
        testID="item-note-input"
        accessibilityLabel="Note"
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        multiline
        maxLength={1000}
        inputStyle={styles.noteInput}
        scrollEnabled={false}
      />
    </View>
  );
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <Text variant="caption" tone="muted" style={styles.saveIndicator}>
      {status === "saving" ? "Saving…" : "Saved"}
    </Text>
  );
}

interface ProvenanceProps {
  item: Item;
  addedByName: string | null;
  completedByName: string | null;
}

function Provenance({ item, addedByName, completedByName }: ProvenanceProps) {
  const parts: string[] = [];
  if (addedByName) {
    parts.push(`Added by ${firstName(addedByName)} · ${formatRelative(item.createdAt)}`);
  } else {
    parts.push(`Added ${formatRelative(item.createdAt)}`);
  }
  if (item.completed && item.completedAt) {
    const who = completedByName ? `by ${firstName(completedByName)} · ` : "";
    parts.push(`Completed ${who}${formatRelative(item.completedAt)}`);
  } else if (item.updatedAt && item.updatedAt !== item.createdAt) {
    parts.push(`Edited ${formatRelative(item.updatedAt)}`);
  }
  return (
    <View style={styles.provenance}>
      {parts.map((p) => (
        <Text key={p} variant="caption" tone="muted" style={styles.provenanceLine}>
          {p}
        </Text>
      ))}
    </View>
  );
}

/* ------------------------------- helpers --------------------------------- */

function describeItem(item: Item): KindView {
  const c = item.content as Record<string, unknown>;
  switch (item.kind) {
    case "movie":
    case "tv": {
      const poster = typeof c.posterUrl === "string" ? c.posterUrl : undefined;
      const year = typeof c.year === "number" ? String(c.year) : null;
      const runtime = typeof c.runtimeMinutes === "number" ? `${c.runtimeMinutes} min` : null;
      const eyebrow = [item.kind === "tv" ? "TV" : "MOVIE", year, runtime]
        .filter(Boolean)
        .join(" · ");
      const overview = typeof c.overview === "string" ? c.overview : "";
      return {
        ...(poster ? { imageUrl: poster } : {}),
        placeholderGlyph: item.kind === "tv" ? "📺" : "🎬",
        subline: overview,
        eyebrow,
        hasUrlField: false,
      };
    }
    case "book": {
      const cover = typeof c.coverUrl === "string" ? c.coverUrl : undefined;
      const authors = Array.isArray(c.authors) ? (c.authors as string[]).join(", ") : "";
      const year = typeof c.year === "number" ? String(c.year) : null;
      const pageCount =
        typeof c.pageCount === "number" && c.pageCount > 0 ? `${c.pageCount} pp` : null;
      const eyebrow = ["BOOK", authors || null, year, pageCount].filter(Boolean).join(" · ");
      const description = typeof c.description === "string" ? c.description : "";
      return {
        ...(cover ? { imageUrl: cover } : {}),
        placeholderGlyph: "📚",
        subline: description,
        eyebrow,
        hasUrlField: false,
      };
    }
    case "link": {
      const image =
        typeof c.imageProxy === "string"
          ? c.imageProxy
          : typeof c.image === "string"
            ? c.image
            : typeof c.thumbnailUrl === "string"
              ? c.thumbnailUrl
              : undefined;
      const siteName = typeof c.siteName === "string" ? c.siteName : "";
      const eyebrow = siteName ? siteName.toUpperCase() : "LINK";
      const description = typeof c.description === "string" ? c.description : "";
      return {
        ...(image ? { imageUrl: image } : {}),
        placeholderGlyph: "🔗",
        subline: description,
        eyebrow,
        hasUrlField: true,
      };
    }
    default: {
      // plain + any future kind: a neutral glyph, no eyebrow.
      return {
        placeholderGlyph: "✦",
        subline: "",
        eyebrow: "",
        hasUrlField: true,
      };
    }
  }
}

function completionLabel(item: Item): string {
  if (item.completed) {
    switch (item.kind) {
      case "movie":
      case "tv":
        return "Mark as not watched";
      case "book":
        return "Mark as not read";
      default:
        return "Mark as not done";
    }
  }
  switch (item.kind) {
    case "movie":
    case "tv":
      return "Mark watched";
    case "book":
      return "Mark read";
    default:
      return "Mark done";
  }
}

function notePlaceholderFor(item: Item, todoEnabled: boolean): string {
  if (item.completed) {
    switch (item.kind) {
      case "movie":
      case "tv":
        return "How was it?";
      case "book":
        return "How was it?";
      default:
        return "Notes";
    }
  }
  switch (item.kind) {
    case "movie":
    case "tv":
      return "Why we want to see it";
    case "book":
      return "Why we want to read it";
    case "link":
      return "Why we saved this";
    case "plain":
      return todoEnabled ? "Notes" : "Add a note";
    default:
      return "Notes";
  }
}

function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const first = trimmed.split(/\s+/)[0];
  return first ?? trimmed;
}

function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function listColorHex(color: string | null | undefined): string {
  if (!color) return tokens.accent.default;
  const palette = tokens.list as Record<string, string>;
  return palette[color] ?? tokens.accent.default;
}

/* -------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  saveIndicator: {
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
  },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },

  // Hero — media (movie / tv / book / link)
  heroMedia: {
    flexDirection: "row",
    gap: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  heroPoster: {
    width: 110,
    height: 165,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  heroLinkImage: {
    width: 110,
    height: 110,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  heroPlaceholder: { alignItems: "center", justifyContent: "center" },
  // Pin lineHeight (≈1.2×) so the 40px hero emoji isn't clipped to the shared
  // Text body line box (22) — iOS clips glyphs taller than their line box.
  heroPlaceholderGlyph: { fontSize: 40, lineHeight: 48 },
  heroMeta: { flex: 1, gap: tokens.space.xs, paddingTop: tokens.space.xxs },
  heroSubline: { lineHeight: 19 },
  // 44pt target; the negative inset keeps the label aligned with the text above.
  openLink: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: tokens.hit,
    paddingHorizontal: tokens.space.sm,
    marginLeft: -tokens.space.sm,
    borderRadius: tokens.radius.md,
  },
  openLinkHovered: { backgroundColor: interaction.hover },
  openLinkPressed: { backgroundColor: interaction.pressed },
  openLinkText: {
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.2,
  },

  // Hero — plain
  heroPlain: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },

  // Title — typographic, no chrome
  titleInput: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xxl,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.4,
    lineHeight: 36,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: 0,
    margin: 0,
  },
  titleInputCompleted: {
    color: tokens.text.muted,
    textDecorationLine: "line-through",
  },

  // URL — single quiet line with optional trailing ↗
  urlRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.xs,
  },
  urlField: { flex: 1 },
  urlInput: { color: tokens.text.secondary },

  // Note — quiet, auto-grow
  noteRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.xs,
  },
  noteInput: { paddingTop: tokens.space.sm, paddingBottom: tokens.space.xs },

  // Tags — chip picker over the list's existing tags
  tagSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.md,
    gap: tokens.space.sm,
  },

  // Primary action — completion
  primaryActionRow: {
    paddingTop: tokens.space.md,
  },
  primaryAction: { width: "100%" },

  // Provenance — bottom
  provenance: {
    paddingTop: tokens.space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    gap: tokens.space.xxs,
  },
  provenanceLine: { lineHeight: 18 },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
});
