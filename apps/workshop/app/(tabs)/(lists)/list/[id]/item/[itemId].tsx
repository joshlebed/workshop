import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, ListDetailResponse } from "@workshop/shared";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  archiveItem,
  completeItem,
  fetchItem,
  uncompleteItem,
  updateItem,
  updateItemTags,
} from "../../../../../../src/api/items";
import { fetchListTags } from "../../../../../../src/api/lists";
import { useAuth } from "../../../../../../src/hooks/useAuth";
import { ApiError } from "../../../../../../src/lib/api";
import { confirm } from "../../../../../../src/lib/confirm";
import { goBack } from "../../../../../../src/lib/goBack";
import { haptics } from "../../../../../../src/lib/haptics";
import { normalizeExternalUrl, openExternalUrl } from "../../../../../../src/lib/openUrl";
import { queryKeys } from "../../../../../../src/lib/queryKeys";
import { formatRelative } from "../../../../../../src/lib/relativeTime";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  Screen,
  Sheet,
  Text,
  tokens,
  useToast,
} from "../../../../../../src/ui/index";

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

  // The list detail is almost always warm in the cache (the user just came
  // from the list screen). Read it without re-fetching so the parent-list
  // chip can paint synchronously.
  const cachedList = listId
    ? queryClient.getQueryData<ListDetailResponse>(queryKeys.lists.detail(listId))
    : null;
  const parentList = cachedList?.list ?? null;
  const listMembers = cachedList?.members ?? [];

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (itemQuery.data?.item) {
      setTitle(itemQuery.data.item.title);
      setNote(itemQuery.data.item.note ?? "");
      setUrl(itemQuery.data.item.url ?? "");
    }
  }, [itemQuery.data?.item]);

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
        message: e instanceof ApiError ? e.message : "Couldn't archive",
        tone: "danger",
      }),
  });

  // Debounced autosave. We compare against the server snapshot (not against
  // the previous draft) so an inflight save that finishes while the user
  // keeps typing doesn't re-snapshot stale state.
  const item = itemQuery.data?.item;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  const flushSave = useCallback(() => {
    if (!item) return;
    const nextTitle = title.trim();
    const nextNote = note.trim();
    const nextUrl = url.trim();
    if (nextTitle.length === 0 || nextTitle.length > 500) return;
    const dirty =
      nextTitle !== item.title || nextNote !== (item.note ?? "") || nextUrl !== (item.url ?? "");
    if (!dirty) return;
    saveMutationRef.current.mutate({ title, note, url });
  }, [item, title, note, url]);

  useEffect(() => {
    if (!item) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const nextTitle = title.trim();
    const dirty =
      nextTitle !== item.title ||
      note.trim() !== (item.note ?? "") ||
      url.trim() !== (item.url ?? "");
    if (!dirty) {
      // Fade the "Saved" indicator out a moment after the last save resolves.
      if (saveStatus === "saved") {
        const t = setTimeout(() => setSaveStatus("idle"), 1800);
        return () => clearTimeout(t);
      }
      return;
    }
    if (nextTitle.length === 0 || nextTitle.length > 500) return;
    debounceRef.current = setTimeout(() => {
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [item, title, note, url, flushSave, saveStatus]);

  if (!itemId || !listId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing item id" />
      </Screen>
    );
  }

  if (itemQuery.isPending) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </Screen>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
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
    setMenuOpen(false);
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
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={parentList ? `Back to ${parentList.name}` : "Back"}
          onPress={() => goBack(`/list/${listId}`)}
          style={({ pressed, hovered }) => [
            styles.parentChip,
            (pressed || hovered) && styles.parentChipPressed,
          ]}
          testID="item-back-to-list"
        >
          <Text style={styles.parentGlyph}>‹</Text>
          {parentList ? (
            <>
              <View style={[styles.parentEmoji, { backgroundColor: `${listAccent}26` }]}>
                <Text style={styles.parentEmojiGlyph}>{parentList.emoji}</Text>
              </View>
              <Text variant="label" tone="secondary" numberOfLines={1} style={styles.parentName}>
                {parentList.name}
              </Text>
            </>
          ) : (
            <Text variant="label" tone="secondary" style={styles.parentName}>
              Back
            </Text>
          )}
        </Pressable>

        <View style={styles.headerRight}>
          <SaveIndicator status={saveStatus} />
          <IconButton accessibilityLabel="More actions" onPress={() => setMenuOpen(true)}>
            <Text style={styles.kebabGlyph}>⋯</Text>
          </IconButton>
        </View>
      </View>

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

        <TextInput
          testID="item-title-input"
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={tokens.text.muted}
          maxLength={500}
          onBlur={flushSave}
          returnKeyType="next"
          style={[styles.titleInput, loadedItem.completed && styles.titleInputCompleted]}
          multiline
          scrollEnabled={false}
        />

        {view.hasUrlField ? (
          <UrlField value={url} onChange={setUrl} onBlur={flushSave} currentUrl={loadedItem.url} />
        ) : null}

        <NoteField
          value={note}
          onChange={setNote}
          onBlur={flushSave}
          placeholder={notePlaceholderFor(loadedItem, todoEnabled)}
        />

        <TagEditor
          tags={loadedItem.tags ?? []}
          listTags={(listTagsQuery.data?.tags ?? []).map((t) => t.tag)}
          pending={tagsMutation.isPending}
          onChange={(next) => tagsMutation.mutate(next)}
        />

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

      <Sheet visible={menuOpen} onRequestClose={() => setMenuOpen(false)} testID="item-menu">
        <View style={styles.menu}>
          {loadedItem.url ? (
            <MenuRow
              testID="item-menu-open"
              label="Open link"
              detail={hostFromUrl(loadedItem.url)}
              onPress={() => {
                setMenuOpen(false);
                onOpenUrl();
              }}
            />
          ) : null}
          <MenuRow testID="item-menu-delete" label="Delete item" destructive onPress={onDelete} />
        </View>
      </Sheet>
    </Screen>
  );
}

/* ------------------------------- subviews -------------------------------- */

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
        <View style={[styles.heroPlainBadge, { backgroundColor: `${accent}26` }]}>
          <Text style={styles.heroPlainGlyph}>{view.placeholderGlyph}</Text>
        </View>
        {view.eyebrow ? (
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            {view.eyebrow}
          </Text>
        ) : null}
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
        { backgroundColor: `${accent}26` },
      ]}
    >
      <Text style={styles.heroPlaceholderGlyph}>{view.placeholderGlyph}</Text>
    </View>
  );

  return (
    <View style={styles.heroMedia}>
      {cover}
      <View style={styles.heroMeta}>
        {view.eyebrow ? (
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            {view.eyebrow}
          </Text>
        ) : null}
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
            style={({ pressed, hovered }) => [
              styles.openLink,
              (pressed || hovered) && styles.openLinkPressed,
            ]}
            testID="item-open-link"
          >
            <Text variant="caption" style={[styles.openLinkText, { color: accent }]}>
              {isLink ? "Open page ↗" : "Open ↗"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface UrlFieldProps {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  currentUrl: string | null;
}

function UrlField({ value, onChange, onBlur, currentUrl }: UrlFieldProps) {
  const trimmed = value.trim();
  const showOpen = trimmed.length > 0 && trimmed === (currentUrl ?? "");
  return (
    <View style={styles.urlRow}>
      <TextInput
        testID="item-url-input"
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        placeholder="Add a link"
        placeholderTextColor={tokens.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={2048}
        style={styles.urlInput}
      />
      {showOpen ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open link"
          onPress={() => openExternalUrl(currentUrl)}
          hitSlop={8}
          style={({ pressed }) => [pressed && styles.openInlinePressed]}
          testID="item-url-open"
        >
          <Text style={styles.urlOpenGlyph}>↗</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface NoteFieldProps {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder: string;
}

function NoteField({ value, onChange, onBlur, placeholder }: NoteFieldProps) {
  return (
    <TextInput
      testID="item-note-input"
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      placeholderTextColor={tokens.text.muted}
      multiline
      maxLength={1000}
      style={styles.noteInput}
      scrollEnabled={false}
    />
  );
}

interface TagEditorProps {
  /** The item's current tags (server-canonical: lowercase, sorted). */
  tags: string[];
  /** Every in-use tag on the parent list — drives the suggested chips. */
  listTags: string[];
  /** A replace-set request is in flight; chips disable to prevent races. */
  pending: boolean;
  onChange: (next: string[]) => void;
}

/** Mirror of the server's tag normalization (trim, lowercase, collapse). */
function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Suggested-chip tag picker (spec §2.1): the item's tags render selected
 * (tap to remove), the rest of the list's in-use tags render as unselected
 * suggestions (tap to add), and a quiet inline input creates a new tag on
 * submit. Never a bare free-text field — the list's existing vocabulary is
 * always one tap away.
 */
function TagEditor({ tags, listTags, pending, onChange }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const suggestions = listTags.filter((t) => !tags.includes(t));

  const addDraft = () => {
    const tag = normalizeTag(draft);
    if (!tag || tag.length > 40) return;
    setDraft("");
    if (tags.includes(tag)) return;
    onChange([...tags, tag]);
  };

  return (
    <View style={styles.tagSection}>
      <Text variant="caption" tone="muted" style={styles.eyebrow}>
        Tags
      </Text>
      <View style={styles.tagChips}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            selected
            disabled={pending}
            onPress={() => onChange(tags.filter((t) => t !== tag))}
            testID={`item-tag-${tag}`}
          />
        ))}
        {suggestions.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            disabled={pending}
            onPress={() => onChange([...tags, tag])}
            testID={`item-tag-suggest-${tag}`}
          />
        ))}
        <TextInput
          testID="item-tag-input"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={addDraft}
          onBlur={addDraft}
          placeholder={tags.length === 0 && suggestions.length === 0 ? "Add a tag" : "Add tag"}
          placeholderTextColor={tokens.text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          // Keep the keyboard up for rapid multi-tag entry on native; web
          // ignores this and keeps focus anyway.
          blurOnSubmit={false}
          style={styles.tagInput}
        />
      </View>
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

interface MenuRowProps {
  label: string;
  detail?: string;
  destructive?: boolean;
  onPress: () => void;
  testID?: string;
}

function MenuRow({ label, detail, destructive, onPress, testID }: MenuRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }) => [
        styles.menuRow,
        (pressed || hovered) && styles.menuRowHover,
      ]}
    >
      <Text style={[styles.menuLabel, destructive && styles.menuLabelDestructive]}>{label}</Text>
      {detail ? (
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.menuDetail}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.sm,
  },
  parentChip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.pill,
    maxWidth: "70%",
  },
  parentChipPressed: { backgroundColor: tokens.bg.surface },
  parentGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl,
    marginRight: -2,
  },
  parentEmoji: {
    width: 26,
    height: 26,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  parentEmojiGlyph: { fontSize: 14 },
  parentName: { flexShrink: 1 },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  kebabGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl,
  },
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
  heroPlaceholderGlyph: { fontSize: 40 },
  heroMeta: { flex: 1, gap: tokens.space.xs, paddingTop: 2 },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontSize: 11,
  },
  heroSubline: { lineHeight: 19 },
  openLink: {
    alignSelf: "flex-start",
    marginTop: tokens.space.xs,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  openLinkPressed: { opacity: 0.7 },
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
  heroPlainBadge: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  heroPlainGlyph: { fontSize: 22 },

  // Title — typographic, no chrome
  titleInput: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xxl,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.4,
    lineHeight: 36,
    paddingVertical: 0,
    paddingHorizontal: 0,
    margin: 0,
  },
  titleInputCompleted: {
    color: tokens.text.muted,
    textDecorationLine: "line-through",
  },

  // URL — single quiet line with optional trailing ↗
  urlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.md,
  },
  urlInput: {
    flex: 1,
    color: tokens.text.secondary,
    fontSize: tokens.font.size.sm,
    paddingVertical: 0,
    paddingHorizontal: 0,
    margin: 0,
  },
  urlOpenGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    paddingHorizontal: tokens.space.xs,
  },
  openInlinePressed: { opacity: 0.6 },

  // Note — quiet, auto-grow
  noteInput: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    lineHeight: 22,
    paddingTop: tokens.space.md,
    paddingHorizontal: 0,
    paddingBottom: 0,
    margin: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    minHeight: 44,
    textAlignVertical: "top",
  },

  // Tags — chip picker over the list's existing tags
  tagSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.md,
    gap: tokens.space.sm,
  },
  tagChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  tagInput: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    paddingVertical: 6,
    paddingHorizontal: tokens.space.sm,
    minWidth: 96,
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
    gap: 2,
  },
  provenanceLine: { lineHeight: 18 },

  // Menu sheet
  menu: { paddingVertical: tokens.space.xs, gap: 2 },
  menuRow: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
  },
  menuRowHover: { backgroundColor: tokens.bg.surface },
  menuLabel: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.medium,
  },
  menuLabelDestructive: { color: tokens.status.danger },
  menuDetail: { flexShrink: 1, maxWidth: "60%", textAlign: "right" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
});
