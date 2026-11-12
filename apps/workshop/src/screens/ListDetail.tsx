import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type {
  Item,
  List,
  ListDetailResponse,
  ListMemberSummary,
  ListRowsResponse,
  ListSource,
  SavedView,
} from "@workshop/shared";
import { inboxTitle as inboxTitleFor, listKind } from "@workshop/shared/listKinds";
import { hasModule } from "@workshop/shared/modules";
import {
  Avatar,
  alpha,
  Button,
  confirm,
  EmojiBadge,
  EmptyState,
  Fab,
  formatRelative,
  haptics,
  Icon,
  IconButton,
  interaction,
  type ListColorKey,
  layout,
  openExternalUrl,
  type PressState,
  Reveal,
  Screen,
  ScreenHeader,
  Skeleton,
  screenColumnStyle,
  TagFilterBar,
  Text,
  TextField,
  timing,
  tokens,
  useRevealAfterLoading,
  useToast,
} from "@workshop/ui";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  type TextInputInstance,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  archiveItem,
  completeItem,
  fetchItems,
  moveItem,
  unarchiveItem,
  uncompleteItem,
} from "../api/items";
import { updateList } from "../api/lists";
import { syncSource } from "../api/sources";
import { createSavedView, deleteSavedView, fetchSavedViews } from "../api/views";
import { ShareListSheet } from "../components/ShareListSheet";
import { useAuth } from "../hooks/useAuth";
import { keepFocusIfOn, keepFocusNearRow, keepFocusOn } from "../lib/a11y/keepFocusNear";
import { FAILURE_TOAST_KEY, failureMessage, loadErrorMessage } from "../lib/errorCopy";
import { useFinePointer } from "../lib/finePointer";
import { goBack } from "../lib/goBack";
import { takeItemsAdded } from "../lib/recentlyAdded";
import { useShortcuts } from "../lib/shortcuts/useShortcuts";
import { sourceErrorMessage } from "../lib/sourceErrors";
import {
  COMPLETED_COLLAPSE_THRESHOLD,
  rememberDoneCollapsed,
  rememberedDoneCollapsed,
} from "./listDetail/completedSection";
import { ItemList } from "./listDetail/ItemList";
import { ItemRowMenu, type ItemRowMenuActions } from "./listDetail/ItemRowMenu";
import { LetterboxdPanel } from "./listDetail/LetterboxdPanel";
import { ListNameEditor } from "./listDetail/ListNameEditor";
import {
  applyComplete,
  applyMove,
  applyRemove,
  applyRestore,
  applyUncomplete,
  completionCopy,
  type DropResult,
  findItem,
  itemCountLabel,
  itemMatches,
  type MoveIntent,
  moveRequest,
  type SectionName,
  stepNeighbours,
  tagChipCounts,
} from "./listDetail/listOps";
import type { ListScrollHandle } from "./listDetail/listProps";
import { SavedViewsBar } from "./listDetail/SavedViewsBar";
import type { Section } from "./listDetail/types";
import { useTwoPane } from "./twoPane/TwoPane";

interface Props {
  list: List;
  members: ListMemberSummary[];
  sources: ListSource[];
  token: string | null;
}

type Placement = { item: Item; section: SectionName; index: number };

/** A stable empty list, so memos keyed on a missing section don't rerun. */
const EMPTY: Item[] = [];

/**
 * Unified list-detail screen. The shape of the screen falls out of `list.modules`:
 *
 * - Every list is one hand-ordered sequence; every open row drags.
 * - `todo` on    → a checkbox on every open row, a Done section below.
 * - `sources` on → header refresh button, and a sync inbox ("New from
 *                  Spotify") below the list for rows nobody has placed yet.
 *
 * Every write here is optimistic (2.2): the cache changes in `onMutate`, a
 * failure puts it back and says so, and reversible ones offer Undo (2.3).
 * `list.itemKind === "spotify_album"` keeps the album-shelf affordances —
 * body-press opens Spotify, no Edit.
 */
/** How long a ticked row stays put before it moves to Done. */
const COMPLETE_HOLD_MS = 1200;

export function ListDetail({ list, members, sources, token }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast, announce, dismissKey } = useToast();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const finePointer = useFinePointer();
  const selfId = user?.id ?? null;
  const filterInputRef = useRef<TextInputInstance>(null);
  const [filter, setFilter] = useState("");
  // Selected tag chips (AND). Stored as an array for stable identity in deps.
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const itemsKey = queryKeys.items.byList(list.id);

  // Rename in place (4.3): optimistic on the detail cache, then refetch.
  const renameList = useCallback(
    async (name: string) => {
      const key = queryKeys.lists.detail(list.id);
      const previous = queryClient.getQueryData<ListDetailResponse>(key);
      if (previous)
        queryClient.setQueryData(key, { ...previous, list: { ...previous.list, name } });
      try {
        await updateList(list.id, { name }, token);
      } catch (e) {
        if (previous) queryClient.setQueryData(key, previous);
        showToast({
          key: FAILURE_TOAST_KEY,
          message: failureMessage(e, "Couldn't rename the list."),
          tone: "danger",
        });
        throw e;
      } finally {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      }
    },
    [list.id, queryClient, token, showToast],
  );
  const writeKey = useMemo(() => ["list-items-write", list.id], [list.id]);
  const livePoll = useLivePollingInterval();

  const itemKind = list.itemKind;
  // What this kind of list offers and calls things (`@workshop/shared/listKinds`).
  const kind = listKind(itemKind);
  const isSpotifyShelf = itemKind === "spotify_album";
  const isOwner = list.ownerId === user?.id;
  const hasSources = sources.length > 0 && hasModule(list.modules, "sources");
  // The server reads unplaced rows as an inbox exactly when `sources` is on.
  const inboxOn = hasModule(list.modules, "sources");
  const todoOn = hasModule(list.modules, "todo");
  const letterboxdOn = hasModule(list.modules, "letterboxd");
  const copy = completionCopy(itemKind);

  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchItems(list.id, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  // A failed background refetch keeps the cached rows on screen (0.9).
  const itemsLoadFailed = itemsQuery.isError && !itemsQuery.data;
  // Rows that replace the skeleton fade in; cached rows appear at once.
  const itemsRevealed = useRevealAfterLoading(itemsQuery.isPending);

  const viewsQuery = useQuery({
    queryKey: queryKeys.views.byList(list.id),
    queryFn: () => fetchSavedViews(list.id, token),
    enabled: !!token,
  });
  const savedViews = viewsQuery.data?.views ?? [];

  // --- New-row highlight + scroll (2.6) ------------------------------------

  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  const [scrollToItemId, setScrollToItemId] = useState<string | null>(null);
  // The quick-add screen stays open across adds and records what it added;
  // pick that up whenever this screen is back on top.
  useEffect(() => {
    if (!isFocused) return;
    const added = takeItemsAdded(list.id);
    if (added.length === 0) return;
    setNewItemIds(new Set(added));
    setScrollToItemId(added[0] ?? null);
  }, [isFocused, list.id]);
  useEffect(() => {
    if (newItemIds.size === 0) return;
    const t = setTimeout(() => {
      setNewItemIds(new Set());
      setScrollToItemId(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [newItemIds]);

  const beforeRefreshIdsRef = useRef<Set<string> | null>(null);
  const primarySource = sources[0] ?? null;

  // Sync now syncs every attached source (a movie list can have a Letterboxd
  // list and Letterboxd match); the last response carries the full rows.
  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (sources.length === 0) throw new Error("no source attached");
      let last: Awaited<ReturnType<typeof syncSource>> | null = null;
      let addedCount = 0;
      for (const source of sources) {
        last = await syncSource(list.id, source.id, token);
        addedCount += last.addedCount;
      }
      if (!last) throw new Error("no source attached");
      return { ...last, addedCount };
    },
    onMutate: () => {
      const cur = queryClient.getQueryData<ListRowsResponse>(itemsKey);
      const prevIds = new Set<string>();
      if (cur) {
        for (const it of [...cur.open, ...cur.inbox, ...cur.completed]) prevIds.add(it.id);
      }
      beforeRefreshIdsRef.current = prevIds;
    },
    onSuccess: (res) => {
      queryClient.setQueryData<ListRowsResponse>(itemsKey, {
        open: res.open,
        inbox: res.inbox,
        completed: res.completed,
        suggested: res.suggested,
        ordered: res.ordered,
        unordered: res.unordered,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
      const added = res.addedCount;
      const before = beforeRefreshIdsRef.current ?? new Set<string>();
      // New arrivals wait in the inbox below the list: show them.
      const fresh = new Set<string>();
      for (const it of [...res.inbox, ...res.open]) {
        if (!before.has(it.id)) fresh.add(it.id);
      }
      if (fresh.size > 0) {
        setNewItemIds(fresh);
        setScrollToItemId([...fresh][0] ?? null);
      }
      showToast({
        message: added === 0 ? "Nothing new" : `${added} new ${added === 1 ? "item" : "items"}`,
        tone: added === 0 ? "default" : "success",
      });
    },
    onError: (e) => {
      showToast({
        message: sourceErrorMessage(e, "Couldn't sync. Try again in a moment."),
        tone: "danger",
      });
    },
  });

  // --- Optimistic writes (2.2, 2.3) ----------------------------------------

  const setItems = useCallback(
    (fn: (d: ListRowsResponse) => ListRowsResponse) => {
      queryClient.setQueryData<ListRowsResponse>(itemsKey, (d) => (d ? fn(d) : d));
    },
    [queryClient, itemsKey],
  );
  // Refetch the server's truth once the last in-flight write settles; doing it
  // after every write would briefly show the list without the others.
  const settleWrites = useCallback(() => {
    if (queryClient.isMutating({ mutationKey: writeKey }) <= 1) {
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    }
  }, [queryClient, itemsKey, writeKey]);

  const moveMutation = useMutation<
    Item,
    Error,
    { item: Item; intent: MoveIntent },
    { previous?: ListRowsResponse }
  >({
    mutationKey: writeKey,
    mutationFn: async ({ item, intent }) =>
      (await moveItem(item.id, moveRequest(intent), token)).item,
    onMutate: async ({ item, intent }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<ListRowsResponse>(itemsKey);
      setItems((d) => applyMove(d, item.id, intent));
      return previous ? { previous } : {};
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous && queryClient.isMutating({ mutationKey: writeKey }) <= 1) {
        queryClient.setQueryData(itemsKey, ctx.previous);
      }
      dismissKey("move");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't move that item."),
        tone: "danger",
      });
    },
    onSettled: settleWrites,
  });

  const completeMutation = useMutation<Item, Error, { item: Item; next: boolean; undo?: boolean }>({
    mutationKey: writeKey,
    mutationFn: async ({ item, next }) =>
      (next ? await completeItem(item.id, token) : await uncompleteItem(item.id, token)).item,
    onMutate: async ({ item, next }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      setItems((d) =>
        next ? applyComplete(d, item.id, selfId) : applyUncomplete(d, item.id, inboxOn),
      );
    },
    onError: (e, { item, next }) => {
      setItems((d) =>
        next ? applyUncomplete(d, item.id, inboxOn) : applyComplete(d, item.id, selfId),
      );
      dismissKey("complete");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't update that item."),
        tone: "danger",
      });
    },
    onSettled: settleWrites,
  });

  // A ticked row stays where it is, checked, for a moment before it moves to
  // Done (5, critique: it left at once and the next row slid under the
  // finger). Ticks in a row reset the clock and land together. The write is
  // sent when the hold ends; leaving the screen or the app sends it at once.
  const [heldDone, setHeldDone] = useState<ReadonlyMap<string, Item>>(() => new Map());
  const heldRef = useRef<Map<string, Item>>(new Map());
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateComplete = completeMutation.mutate;
  const flushHeld = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    const items = [...heldRef.current.values()];
    if (items.length === 0) return;
    heldRef.current = new Map();
    setHeldDone(new Map());
    for (const item of items) {
      // Web: a keyboard tick keeps focus on its checkbox as the row moves.
      keepFocusIfOn(`item-row-check-${item.id}`);
      mutateComplete({ item, next: true });
    }
  }, [mutateComplete]);
  const setHeld = useCallback((next: Map<string, Item>) => {
    heldRef.current = next;
    setHeldDone(next);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushHeld();
    });
    return () => {
      sub.remove();
      flushHeld();
    };
  }, [flushHeld]);

  const toggleComplete = useCallback(
    (item: Item, next: boolean) => {
      haptics.light();
      const held = heldRef.current.has(item.id);
      if (!next && held) {
        // Unticked during the hold: nothing was sent, so nothing to undo.
        const rest = new Map(heldRef.current);
        rest.delete(item.id);
        setHeld(rest);
        dismissKey("complete");
        return;
      }
      if (next) {
        setHeld(new Map(heldRef.current).set(item.id, item));
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(flushHeld, COMPLETE_HOLD_MS);
      } else {
        mutateComplete({ item, next });
      }
      showToast({
        key: "complete",
        message: next ? copy.marked : copy.unmarked,
        actionLabel: "Undo",
        durationMs: 5000,
        onAction: () => {
          haptics.light();
          keepFocusOn(`item-row-check-${item.id}`);
          if (next && heldRef.current.has(item.id)) {
            const rest = new Map(heldRef.current);
            rest.delete(item.id);
            setHeld(rest);
            return;
          }
          mutateComplete({ item, next: !next, undo: true });
        },
      });
    },
    [mutateComplete, showToast, copy, flushHeld, setHeld, dismissKey],
  );

  // A delete's request, so an Undo pressed before it lands waits for it
  // instead of racing it (restore first, delete second would win).
  const pendingDeletes = useRef(new Map<string, Promise<unknown>>());

  const restoreMutation = useMutation<Item, Error, Placement>({
    mutationKey: writeKey,
    mutationFn: async (placement) => {
      await pendingDeletes.current.get(placement.item.id)?.catch(() => {});
      return (await unarchiveItem(placement.item.id, token)).item;
    },
    onMutate: async (placement) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      setItems((d) => applyRestore(d, placement));
    },
    onError: (e, placement) => {
      setItems((d) => applyRemove(d, placement.item.id));
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't restore that item."),
        tone: "danger",
      });
    },
    onSettled: settleWrites,
  });

  const deleteMutation = useMutation<{ ok: true }, Error, Placement>({
    mutationKey: writeKey,
    mutationFn: (placement) => {
      const p = archiveItem(placement.item.id, token);
      pendingDeletes.current.set(placement.item.id, p);
      return p.finally(() => pendingDeletes.current.delete(placement.item.id));
    },
    onMutate: async (placement) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      setItems((d) => applyRemove(d, placement.item.id));
    },
    onError: (e, placement) => {
      setItems((d) => applyRestore(d, placement));
      dismissKey("delete");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't delete that item."),
        tone: "danger",
      });
    },
    onSettled: settleWrites,
  });

  const deleteItem = useCallback(
    (item: Item) => {
      const data = queryClient.getQueryData<ListRowsResponse>(itemsKey);
      const placement = data ? findItem(data, item.id) : null;
      if (!placement) return;
      haptics.warning();
      // Web: the row (and maybe the focused control in it) is about to go.
      keepFocusNearRow("item-row-body-", item.id);
      deleteMutation.mutate(placement);
      showToast({
        key: "delete",
        message: `Deleted “${item.title}”`,
        actionLabel: "Undo",
        durationMs: 6000,
        onAction: () => {
          haptics.light();
          restoreMutation.mutate(placement);
          // The Undo button is about to go; land on the row that came back.
          keepFocusOn(`item-row-body-${item.id}`, { force: true });
        },
      });
    },
    [queryClient, itemsKey, deleteMutation, restoreMutation, showToast],
  );

  const createViewMutation = useMutation<SavedView, Error, { name: string; tags: string[] }>({
    mutationFn: async ({ name, tags }) => {
      const res = await createSavedView(list.id, { name, config: { tags } }, token);
      return res.view;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.views.byList(list.id) });
      showToast({ message: "View saved", tone: "success" });
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't save that view."),
        tone: "danger",
      });
    },
  });

  const deleteViewMutation = useMutation<{ ok: true }, Error, { viewId: string }>({
    mutationFn: ({ viewId }) => deleteSavedView(list.id, viewId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.views.byList(list.id) });
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't delete that view."),
        tone: "danger",
      });
    },
  });

  // --- Derived rows --------------------------------------------------------

  const data = itemsQuery.data;
  const openRaw = data?.open ?? EMPTY;
  const inboxRaw = data?.inbox ?? EMPTY;
  const completedRaw = data?.completed ?? EMPTY;
  const suggestedRaw = data?.suggested ?? EMPTY;
  const allRows = useMemo(
    () => [...openRaw, ...inboxRaw, ...completedRaw],
    [openRaw, inboxRaw, completedRaw],
  );

  // Letterboxd-match overlap badge per item, replacing "Added by …".
  const letterboxdBadgeByItem = useMemo(() => {
    if (!letterboxdOn) return undefined;
    const map = new Map<string, string>();
    const nameOf = (userId: string) =>
      userId === selfId ? "you" : (memberNameByIdRef(members, userId) ?? "someone");
    for (const it of allRows) {
      const lb = it.letterboxd;
      if (!lb) continue;
      const n = lb.watchlistOf.length;
      if (n >= 2) {
        map.set(it.id, `On ${n} watchlists · ${lb.watchlistOf.map(nameOf).join(", ")}`);
      } else if (n === 1) {
        map.set(it.id, `Only on ${nameOf(lb.watchlistOf[0] ?? "")}'s watchlist now`);
      } else if (lb.acceptances.length > 0) {
        map.set(it.id, `Accepted by ${lb.acceptances.map((a) => nameOf(a.userId)).join(", ")}`);
      } else {
        map.set(it.id, "Off everyone's watchlists now");
      }
    }
    return map;
  }, [letterboxdOn, allRows, members, selfId]);

  const itemFilter = useMemo(() => ({ text: filter, tags: selectedTags }), [filter, selectedTags]);
  const filterActive = filter.trim().length > 0;
  const tagFilterActive = selectedTags.length > 0;
  const anyFilterActive = filterActive || tagFilterActive;

  const filtered = useMemo(() => {
    if (!anyFilterActive) {
      return { open: openRaw, inbox: inboxRaw, completed: completedRaw };
    }
    const keep = (it: Item) => itemMatches(it, itemFilter);
    return {
      open: openRaw.filter(keep),
      inbox: inboxRaw.filter(keep),
      completed: completedRaw.filter(keep),
    };
  }, [openRaw, inboxRaw, completedRaw, itemFilter, anyFilterActive]);

  // Chip counts follow the current result (text search included), in a
  // stable order so a tap never reshuffles the bar (2.11).
  const tagChips = useMemo(
    () => tagChipCounts(allRows, [...filtered.open, ...filtered.inbox, ...filtered.completed]),
    [allRows, filtered],
  );

  // Drop selected tags that no longer exist on any item.
  useEffect(() => {
    if (selectedTags.length === 0 || itemsQuery.isPending) return;
    const live = new Set(tagChips.map((t) => t.tag));
    if (selectedTags.some((t) => !live.has(t))) {
      setSelectedTags((prev) => prev.filter((t) => live.has(t)));
    }
  }, [tagChips, selectedTags, itemsQuery.isPending]);

  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.displayName) map.set(m.userId, m.displayName);
    }
    return map;
  }, [members]);

  const accent =
    (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default;
  const lastRefreshedAt = primarySource?.lastSyncedAt ?? null;
  const lastRefreshedByName = primarySource?.lastSyncedBy
    ? (memberNameById.get(primarySource.lastSyncedBy) ?? null)
    : null;
  const refreshing = refreshMutation.isPending;

  const totalRows = filtered.open.length + filtered.inbox.length + filtered.completed.length;
  const totalRowsUnfiltered = allRows.length;
  const openCount = openRaw.length + inboxRaw.length;

  // --- Done section (2.10) -------------------------------------------------

  const [doneCollapsedPref, setDoneCollapsedPref] = useState<boolean | undefined>(() =>
    rememberedDoneCollapsed(list.id),
  );
  const doneCollapsedDefault = completedRaw.length > COMPLETED_COLLAPSE_THRESHOLD;
  // A filter shows every match, Done included; otherwise Done is collapsible
  // whenever there is something open above it.
  const doneCollapsible = !anyFilterActive && openCount > 0;
  const doneCollapsed = doneCollapsible && (doneCollapsedPref ?? doneCollapsedDefault);
  const toggleDone = () => {
    haptics.selection();
    const next = !doneCollapsed;
    setDoneCollapsedPref(next);
    rememberDoneCollapsed(list.id, next);
  };

  // --- Saved views ---------------------------------------------------------

  const currentSelectionSaved = savedViews.some((v) => tagSetsEqual(v.config.tags, selectedTags));
  const canSaveView = tagFilterActive && !currentSelectionSaved;
  const viewMutating = createViewMutation.isPending || deleteViewMutation.isPending;

  // The view chip gives the selection tick itself (`Chip`).
  const onApplyView = (view: SavedView) => {
    setSelectedTags((prev) => (tagSetsEqual(prev, view.config.tags) ? [] : [...view.config.tags]));
  };

  const onDeleteView = async (view: SavedView) => {
    const ok = await confirm({
      title: `Delete the “${view.name}” view?`,
      message: "This removes it for everyone on the list.",
      confirmLabel: "Delete view",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    deleteViewMutation.mutate({ viewId: view.id });
  };

  const savedViewsProps = {
    views: savedViews,
    selectedTags,
    onApply: onApplyView,
    onCreate: (name: string) => {
      haptics.success();
      createViewMutation.mutate({ name, tags: selectedTags });
    },
    onDelete: onDeleteView,
    canDelete: (view: SavedView) =>
      !!selfId && (view.createdBy === selfId || list.ownerId === selfId),
    canSave: canSaveView,
    busy: viewMutating,
  };

  // --- Moves ---------------------------------------------------------------

  const itemById = useMemo(() => new Map(allRows.map((it) => [it.id, it])), [allRows]);

  const onDrop = useCallback(
    (drop: DropResult) => {
      const item = itemById.get(drop.itemId);
      if (!item) return;
      haptics.selection();
      moveMutation.mutate({ item, intent: drop });
    },
    [itemById, moveMutation],
  );

  /** Where a row sits now, as a move that would put it back (for Undo). */
  const placementIntent = (item: Item): MoveIntent | null => {
    if (inboxRaw.some((i) => i.id === item.id)) {
      return { beforeItemId: null, afterItemId: null, toInbox: true };
    }
    const i = openRaw.findIndex((r) => r.id === item.id);
    if (i < 0) return null;
    return { beforeItemId: openRaw[i - 1]?.id ?? null, afterItemId: openRaw[i + 1]?.id ?? null };
  };

  const moveWithUndo = (item: Item, intent: MoveIntent, message: string) => {
    const back = placementIntent(item);
    haptics.selection();
    moveMutation.mutate({ item, intent });
    showToast({
      key: "move",
      message,
      ...(back
        ? {
            actionLabel: "Undo",
            durationMs: 5000,
            onAction: () => {
              haptics.selection();
              moveMutation.mutate({ item, intent: back });
            },
          }
        : {}),
    });
  };

  // --- Row menu ------------------------------------------------------------

  const [menuItem, setMenuItem] = useState<Item | null>(null);
  const [menuActions, setMenuActions] = useState<ItemRowMenuActions | null>(null);
  const closeMenu = () => {
    setMenuItem(null);
    setMenuActions(null);
  };

  const onRowMenu = (item: Item, section: Section) => {
    const done = section === "completed";
    const inList = section === "open";
    // Move up / down step past the row the user can see above or below.
    const stepUp = inList ? stepNeighbours(filtered.open, item.id, "up") : null;
    const stepDown = inList ? stepNeighbours(filtered.open, item.id, "down") : null;
    setMenuItem(item);
    setMenuActions({
      ...(section === "inbox"
        ? {
            onAddToList: () =>
              moveWithUndo(item, { beforeItemId: null, afterItemId: null }, "Added to the list"),
          }
        : {}),
      ...(todoOn
        ? {
            completion: {
              label: done ? copy.unmark : copy.mark,
              onPress: () => toggleComplete(item, !done),
            },
          }
        : {}),
      ...(stepUp
        ? {
            onMoveUp: () => {
              haptics.selection();
              moveMutation.mutate({ item, intent: stepUp });
              // The move shows on screen; say it for screen readers.
              announce(`Moved “${item.title}” up`);
            },
          }
        : {}),
      ...(stepDown
        ? {
            onMoveDown: () => {
              haptics.selection();
              moveMutation.mutate({ item, intent: stepDown });
              announce(`Moved “${item.title}” down`);
            },
          }
        : {}),
      // Already first in the whole list (not just the filtered view): nothing to do.
      ...(inList && openRaw[0]?.id !== item.id
        ? {
            onMoveToTop: () =>
              moveWithUndo(item, { beforeItemId: null, afterItemId: null }, "Moved to top"),
          }
        : {}),
      onDelete: () => deleteItem(item),
    });
  };

  const onRowPressBody = (item: Item) => {
    if (isSpotifyShelf) {
      const c = item.content as { spotifyAlbumUrl?: string };
      openExternalUrl(c.spotifyAlbumUrl);
      return;
    }
    router.push(`/list/${list.id}/item/${item.id}`);
  };

  const headerSubline = useMemo(() => {
    // Members only when the list is shared: "1 member" on a solo list was
    // noise (5, critique).
    const parts = members.length > 1 ? [`${members.length} members`] : [];
    const line = (...more: string[]) => [...parts, ...more].join(" · ");
    if (hasSources) {
      if (refreshing) return "Syncing…";
      if (!lastRefreshedAt) return line() || "Not synced yet";
      const rel = formatRelative(lastRefreshedAt);
      const actor = lastRefreshedByName ? ` by ${lastRefreshedByName}` : "";
      return line(`${parts.length > 0 ? "synced" : "Synced"} ${rel}${actor}`);
    }
    if (totalRowsUnfiltered === 0) return line() || "Empty";
    // The count is what's left to do, not the archive (2.10).
    if (todoOn) {
      if (openCount === 0) {
        return line(`${parts.length > 0 ? "all" : "All"} ${copy.done.toLowerCase()}`);
      }
      return line(copy.openCount(openCount));
    }
    return line(itemCountLabel(openCount, itemKind));
  }, [
    hasSources,
    refreshing,
    members.length,
    lastRefreshedAt,
    lastRefreshedByName,
    totalRowsUnfiltered,
    todoOn,
    openCount,
    copy,
    itemKind,
  ]);

  const isEmptyAfterFetch = !itemsQuery.isPending && !itemsLoadFailed && totalRowsUnfiltered === 0;
  const isFilterEmpty =
    !itemsQuery.isPending &&
    !itemsLoadFailed &&
    anyFilterActive &&
    totalRows === 0 &&
    totalRowsUnfiltered > 0;
  const showSearch = !itemsQuery.isPending && !itemsLoadFailed && totalRowsUnfiltered > 0;
  // Shortcut hints only where there is a keyboard to press them (2.14).
  const showKeyHints = Platform.OS === "web" && finePointer;
  // A sync-only kind (album shelf) has no manual add: rows come from its source.
  const canAdd = kind.add.mode !== "sync_only";

  // Keyboard shortcuts, only while this screen is the one on top: an item
  // detail pushed over it must keep "n" and "/" to itself. Escape inside the
  // filter clears it (react-native-web's input swallows its own keydown, so
  // the field also handles it, below).
  useEffect(() => {
    if (Platform.OS !== "web" || !isFocused) return;
    const handler = (e: KeyboardEvent) => {
      const input: unknown = filterInputRef.current;
      if (e.key !== "Escape" || !input || e.target !== input) return;
      e.preventDefault();
      setFilter("");
      filterInputRef.current?.blur?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFocused]);

  // The pinned bar shows the list name once the title block has scrolled
  // away (`titleBottom` is where it ends inside the scroll content).
  const scrollY = useSharedValue(0);
  const [titleBottom, setTitleBottom] = useState(0);
  const [scrolledPast, setScrolledPast] = useState(false);
  // Where the search field and tag bar end: past it, the bar offers search.
  const [toolsBottom, setToolsBottom] = useState(0);
  const [toolsHidden, setToolsHidden] = useState(false);
  useAnimatedReaction(
    () => toolsBottom > 0 && scrollY.value > toolsBottom - tokens.space.sm,
    (past, before) => {
      if (past !== before) runOnJS(setToolsHidden)(past);
    },
    [toolsBottom],
  );
  useAnimatedReaction(
    () => titleBottom > 0 && scrollY.value > titleBottom - tokens.space.sm,
    (past, before) => {
      if (past !== before) runOnJS(setScrolledPast)(past);
    },
    [titleBottom],
  );
  const listScrollRef = useRef<ListScrollHandle>(null);
  const plainScrollRef = useRef<ScrollViewInstance>(null);
  // Back up to the search field and put the cursor in it (the bar's search
  // control, a filter chip, `/` and ⌘K while the header is scrolled away).
  const scrollToField = useCallback(() => {
    // A jump, not a smooth scroll: focusing the field mid-animation stopped
    // the scroll short of the top.
    const target: ListScrollHandle | null = listScrollRef.current ?? plainScrollRef.current;
    target?.scrollTo({ y: 0, animated: false });
    setTimeout(() => filterInputRef.current?.focus?.(), 0);
  }, []);
  const filtering = filterActive || tagFilterActive;
  const filterSummary = filterActive
    ? `“${filter.trim()}”`
    : selectedTags.length === 1
      ? (selectedTags[0] ?? "")
      : `${selectedTags.length} tags`;

  useShortcuts(
    {
      // `/` and ⌘K: the field may have scrolled away with the header.
      search: () => (toolsHidden ? scrollToField() : filterInputRef.current?.focus?.()),
      new: canAdd ? () => router.push(`/list/${list.id}/add`) : undefined,
    },
    isFocused,
  );

  // UX pass 5 review: only a compact bar stays pinned (back, the list name
  // once the big title has scrolled away, share, settings). The title block,
  // search and filters scroll with the rows, so a phone shows content from
  // the top instead of a third of the screen of fixed chrome.
  const scrollHeader = (
    <>
      <ListTitleBlock
        list={list}
        members={members}
        accent={accent}
        subline={headerSubline}
        onRename={isOwner ? renameList : undefined}
        onLayout={(e) => setTitleBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
      />
      <View onLayout={(e) => setToolsBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        {showSearch ? (
          <View style={[styles.toolbar, screenColumnStyle]}>
            <TextField
              ref={filterInputRef}
              variant="search"
              testID="list-detail-filter"
              value={filter}
              onChangeText={setFilter}
              onClear={() => setFilter("")}
              placeholder={isSpotifyShelf ? "Search this shelf" : "Search this list"}
              accessibilityLabel="Search items in this list"
              onSubmitEditing={() => filterInputRef.current?.blur()}
              // react-native-web's TextInput stops keydown propagation, so the
              // window-level Escape handler never sees keys typed in here.
              onKeyPress={(e) => {
                if (e.nativeEvent.key !== "Escape") return;
                setFilter("");
                filterInputRef.current?.blur();
              }}
              trailing={
                <>
                  {filterActive && totalRows > 0 && totalRows < totalRowsUnfiltered ? (
                    <Text
                      variant="caption"
                      style={styles.filterCount}
                      tone="muted"
                      testID="list-detail-filter-count"
                    >
                      {totalRows}/{totalRowsUnfiltered}
                    </Text>
                  ) : null}
                  {filter.length === 0 && showKeyHints ? (
                    <Text
                      variant="caption"
                      style={styles.filterKbd}
                      tone="muted"
                      accessibilityElementsHidden
                      testID="list-detail-filter-kbd"
                    >
                      /
                    </Text>
                  ) : null}
                </>
              }
            />
          </View>
        ) : null}

        {showSearch && savedViews.length > 0 ? (
          <View style={[styles.savedViewsWrap, screenColumnStyle]}>
            <SavedViewsBar part="views" {...savedViewsProps} />
          </View>
        ) : null}

        {tagChips.length > 0 && showSearch ? (
          <View style={[styles.tagBarWrap, screenColumnStyle]}>
            <TagFilterBar
              tags={tagChips}
              selected={selectedTagSet}
              onToggle={(tag) =>
                setSelectedTags((prev) =>
                  prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                )
              }
              onClearAll={() => setSelectedTags([])}
              trailing={<SavedViewsBar part="save" {...savedViewsProps} />}
            />
          </View>
        ) : null}
      </View>
    </>
  );

  const filterEmptyView = (
    <View style={styles.center}>
      <EmptyState
        title="No matches"
        description={
          tagFilterActive && !filterActive
            ? `Nothing in this list is tagged ${selectedTags.map((t) => `“${t}”`).join(" and ")}.`
            : tagFilterActive
              ? `Nothing tagged ${selectedTags.map((t) => `“${t}”`).join(" and ")} matches “${filter.trim()}.”`
              : `Nothing in this list matches “${filter.trim()}.”`
        }
        action={
          <Button
            label={tagFilterActive ? "Clear filters" : "Clear search"}
            variant="secondary"
            onPress={() => {
              setFilter("");
              setSelectedTags([]);
            }}
            testID="list-detail-filter-clear"
          />
        }
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        style={styles.column}
        overlay={
          canAdd && !(isEmptyAfterFetch && !hasSources) ? (
            <Fab
              accessibilityLabel="Add item"
              tooltip="Add item  (N)"
              onPress={() => router.push(`/list/${list.id}/add`)}
              testID="fab-add-item"
            />
          ) : null
        }
      >
        <ListBar
          name={list.name}
          titleVisible={scrolledPast}
          trailing={
            <>
              {toolsHidden && showSearch ? (
                filtering ? (
                  <FilterSummaryChip
                    label={filterSummary}
                    onPress={scrollToField}
                    onClear={() => {
                      setFilter("");
                      setSelectedTags([]);
                    }}
                  />
                ) : (
                  <IconButton
                    icon="search"
                    accessibilityLabel="Search this list"
                    onPress={scrollToField}
                    testID="list-detail-bar-search"
                  />
                )
              ) : null}
              {hasSources ? (
                <IconButton
                  icon="refresh"
                  accessibilityLabel="Sync now"
                  onPress={() => refreshMutation.mutate()}
                  busy={refreshing}
                  testID="list-detail-refresh"
                />
              ) : null}
              <IconButton
                icon="share"
                accessibilityLabel="Share list"
                onPress={() => setShareOpen(true)}
                testID="list-detail-share"
              />
              <IconButton
                icon="settings"
                accessibilityLabel="List settings"
                onPress={() => router.push(`/list/${list.id}/settings`)}
                testID="list-detail-settings"
              />
            </>
          }
        />

        {itemsQuery.isPending || itemsLoadFailed || (isEmptyAfterFetch && !isFilterEmpty) ? (
          <ScrollView
            ref={plainScrollRef}
            style={styles.listWrap}
            contentContainerStyle={[styles.stateScroll, screenColumnStyle]}
            onScroll={(e) => {
              scrollY.value = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
          >
            {scrollHeader}
            {itemsQuery.isPending ? (
              <View style={screenColumnStyle}>
                <Skeleton.Rows count={6} badge={0} testID="list-detail-loading" />
              </View>
            ) : itemsLoadFailed ? (
              <View style={styles.center}>
                <EmptyState
                  motion
                  illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                  title="Couldn't load this list"
                  description={
                    isSpotifyShelf
                      ? sourceErrorMessage(itemsQuery.error, loadErrorMessage(itemsQuery.error))
                      : loadErrorMessage(itemsQuery.error)
                  }
                  action={
                    <Button
                      label="Try again"
                      variant="secondary"
                      onPress={() => itemsQuery.refetch()}
                      testID="list-detail-retry"
                    />
                  }
                />
              </View>
            ) : (
              <View style={letterboxdOn ? styles.listWrap : styles.center}>
                {letterboxdOn ? (
                  <>
                    <LetterboxdPanel
                      list={list}
                      members={members}
                      suggested={suggestedRaw}
                      token={token}
                      accent={accent}
                      onRequestSync={() => refreshMutation.mutate()}
                    />
                    <View style={styles.center}>
                      <EmptyState
                        motion
                        illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                        title="No films in common yet"
                        description={
                          members.length < 2
                            ? "Share this list with a friend and connect your Letterboxd accounts. Films you both want to watch show up here."
                            : "Once two members connect Letterboxd, films on both watchlists show up here. You can also suggest one above."
                        }
                        action={
                          <Button
                            label="Check for matches"
                            onPress={() => refreshMutation.mutate()}
                            loading={refreshing}
                            testID="list-detail-empty-refresh"
                          />
                        }
                      />
                    </View>
                  </>
                ) : hasSources ? (
                  <EmptyState
                    motion
                    illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                    title={lastRefreshedAt ? "Nothing synced yet" : "Syncing…"}
                    description={
                      lastRefreshedAt
                        ? lastRefreshedByName
                          ? `Last synced by ${lastRefreshedByName}. Check that the linked list is public and not empty.`
                          : "Check that the linked list is public and not empty."
                        : "This usually takes a few seconds."
                    }
                    action={
                      lastRefreshedAt ? (
                        <Button
                          label="Sync now"
                          onPress={() => refreshMutation.mutate()}
                          loading={refreshing}
                          testID="list-detail-empty-refresh"
                        />
                      ) : undefined
                    }
                  />
                ) : !canAdd ? (
                  // Nothing feeds a sync-only list yet: its one action is to
                  // connect the source (owner), not a manual Add.
                  <EmptyState
                    motion
                    illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                    title={kind.empty.title}
                    description={
                      isOwner
                        ? kind.empty.description
                        : `${kind.empty.description} The owner can connect one in list settings.`
                    }
                    action={
                      isOwner ? (
                        <Button
                          label={kind.empty.action}
                          onPress={() => router.push(`/list/${list.id}/settings`)}
                          testID="list-detail-empty-connect"
                        />
                      ) : undefined
                    }
                  />
                ) : (
                  <EmptyState
                    motion
                    illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                    title={kind.empty.title}
                    description={kind.empty.description}
                    accessibilityLabel={`${kind.empty.title}. ${kind.empty.description}`}
                    action={
                      <Button
                        label={kind.empty.action}
                        onPress={() => router.push(`/list/${list.id}/add`)}
                        testID="list-detail-empty-add"
                      />
                    }
                    hint={
                      <View style={styles.emptyHintGroup}>
                        {members.length > 1 ? (
                          <Text
                            variant="caption"
                            tone="muted"
                            style={styles.emptySharedLine}
                            testID="list-detail-empty-shared-line"
                          >
                            Shared with {members.length - 1}{" "}
                            {members.length === 2 ? "other" : "others"}
                            {". "}Anything you add shows up for them too.
                          </Text>
                        ) : null}
                        {showKeyHints ? (
                          <View
                            style={styles.emptyKbdRow}
                            accessibilityElementsHidden
                            testID="list-detail-empty-kbd"
                          >
                            <Text variant="caption" tone="muted">
                              press
                            </Text>
                            <Text variant="caption" style={styles.emptyKbd} tone="secondary">
                              n
                            </Text>
                            <Text variant="caption" tone="muted">
                              to add
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    }
                  />
                )}
              </View>
            )}
          </ScrollView>
        ) : (
          <Reveal when={itemsRevealed} style={styles.listWrap}>
            <ItemList
              header={
                <>
                  {scrollHeader}
                  {letterboxdOn ? (
                    <LetterboxdPanel
                      list={list}
                      members={members}
                      suggested={suggestedRaw}
                      token={token}
                      accent={accent}
                      onRequestSync={() => refreshMutation.mutate()}
                    />
                  ) : null}
                </>
              }
              placeholder={isFilterEmpty ? filterEmptyView : undefined}
              scrollY={scrollY}
              scrollRef={listScrollRef}
              open={filtered.open}
              inbox={filtered.inbox}
              completed={filtered.completed}
              inboxTitle={inboxTitleFor(sources.map((src) => src.kind))}
              listEmpty={openRaw.length === 0 && inboxRaw.length > 0 && !anyFilterActive}
              letterboxdBadgeByItem={letterboxdBadgeByItem}
              listItemKind={itemKind}
              todoOn={todoOn}
              copy={copy}
              showCover={kind.cover}
              newItemIds={newItemIds}
              heldDoneIds={heldDone}
              scrollToItemId={scrollToItemId}
              memberNameById={memberNameById}
              showProvenance={members.length > 1}
              selfId={selfId}
              accent={accent}
              doneCollapsed={doneCollapsed}
              doneCollapsible={doneCollapsible}
              onToggleDone={toggleDone}
              onDrop={onDrop}
              onRowMenu={onRowMenu}
              onRowPressBody={onRowPressBody}
              onToggleComplete={toggleComplete}
              refreshing={manualRefreshing}
              onRefresh={async () => {
                setManualRefreshing(true);
                try {
                  await itemsQuery.refetch();
                } finally {
                  setManualRefreshing(false);
                }
              }}
            />
          </Reveal>
        )}

        <ItemRowMenu item={menuItem} actions={menuActions} onClose={closeMenu} />
        <ShareListSheet list={list} visible={shareOpen} onClose={() => setShareOpen(false)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * The list's header (back, actions, badge, name, members + count), drawn at
 * rest. Exported so the route can paint it from the home cache before the
 * list's own detail request lands (2.13); the live screen splits it into the
 * pinned `ListBar` and the scrolling `ListTitleBlock`.
 */
export function ListHeader({
  list,
  members,
  accent,
  subline,
  trailing,
  onRename,
}: {
  list: Pick<List, "name" | "emoji" | "coverPhotoUrl">;
  members: ListMemberSummary[];
  accent: string;
  subline: string | null;
  trailing?: React.ReactNode;
  /** Owners rename the list in place (4.3). */
  onRename?: (name: string) => Promise<void>;
}) {
  return (
    <>
      <ListBar name={list.name} titleVisible={false} trailing={trailing} />
      <ListTitleBlock
        list={list}
        members={members}
        accent={accent}
        subline={subline}
        onRename={onRename}
      />
    </>
  );
}

/**
 * The one pinned bar (UX pass 5 review): back, the list name once the big
 * title has scrolled out (a `fast` fade; at once under reduced motion), and
 * the actions. The bar's name is decoration for sighted users: the title
 * block's heading stays the screen's h1.
 */
function ListBar({
  name,
  titleVisible,
  trailing,
}: {
  name: string;
  titleVisible: boolean;
  trailing?: React.ReactNode;
}) {
  const twoPane = useTwoPane();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(titleVisible ? 1 : 0);
  useEffect(() => {
    shown.value = reduceMotion
      ? titleVisible
        ? 1
        : 0
      : withTiming(titleVisible ? 1 : 0, timing("fast"));
  }, [titleVisible, reduceMotion, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <ScreenHeader
      // In the desktop two-pane layout the sidebar is the way between
      // lists, so the list itself has no back button (5.7c).
      leading={twoPane ? "none" : "back"}
      onLeadingPress={() => goBack("/")}
      leadingTestID="list-detail-back"
      style={titleVisible ? { ...styles.bar, ...styles.barScrolled } : styles.bar}
      center={
        <Animated.View
          style={[styles.barTitle, fade]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          testID="list-detail-bar-title"
        >
          <Text variant="heading" headerRole={false} numberOfLines={1}>
            {name}
          </Text>
        </Animated.View>
      }
      trailing={trailing}
    />
  );
}

/** Badge, name (renamable by the owner), members and count; scrolls with the list. */
function ListTitleBlock({
  list,
  members,
  accent,
  subline,
  onRename,
  onLayout,
}: {
  list: Pick<List, "name" | "emoji" | "coverPhotoUrl">;
  members: ListMemberSummary[];
  accent: string;
  subline: string | null;
  onRename?: (name: string) => Promise<void>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <View style={[styles.titleBlock, screenColumnStyle]} onLayout={onLayout}>
      <EmojiBadge
        emoji={list.emoji}
        color={accent}
        imageUrl={list.coverPhotoUrl}
        size={44}
        shape="rounded"
      />
      <View style={styles.titleText}>
        <ListNameEditor name={list.name} onRename={onRename} style={styles.titleName} />
        <View style={styles.sublineRow}>
          {members.length > 1 ? <MemberStack members={members} /> : null}
          {subline ? (
            <Text
              variant="caption"
              tone="muted"
              style={styles.subline}
              testID="list-detail-subline"
            >
              {subline}
            </Text>
          ) : (
            <Skeleton.Block width={120} height={12} />
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * In the pinned bar while the header is scrolled away and a search or tag
 * filter is on: says what's filtering, scrolls back to the field on tap, and
 * clears it with its own button.
 */
function FilterSummaryChip({
  label,
  onPress,
  onClear,
}: {
  label: string;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.filterChip} testID="list-detail-bar-filter">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filtered by ${label}. Edit the filter`}
        onPress={onPress}
        style={({ hovered, pressed }: PressState) => [
          styles.filterChipLabel,
          hovered && { backgroundColor: interaction.hover },
          pressed && { backgroundColor: interaction.pressed },
        ]}
      >
        <Icon name="search" size={14} tone="accent" />
        <Text variant="label" style={styles.filterChipText} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <IconButton
        icon="close"
        iconSize={14}
        iconTone="secondary"
        accessibilityLabel="Clear filter"
        onPress={onClear}
        testID="list-detail-bar-filter-clear"
      />
    </View>
  );
}

/** Display-name lookup that tolerates members who've left the list. */
function memberNameByIdRef(members: ListMemberSummary[], userId: string): string | null {
  return members.find((m) => m.userId === userId)?.displayName ?? null;
}

/** True when two tag selections hold the same set (order-insensitive). */
function tagSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

// Per-list-color halo behind the list's emoji. Carries the list's identity
// (its hue, its emoji) into the zero-items canvas so the empty state belongs
// to *this* list, not to "lists in general." A single soft tinted disc; no
// border, no glow, no gradient — DESIGN.md "calm by default" + per-list
// color used only to identify the list.
function ListEmptyHalo({ accent, emoji }: { accent: string; emoji: string }) {
  return (
    <View
      style={[emptyHaloStyles.disc, { backgroundColor: alpha(accent, 0.12) }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={emptyHaloStyles.emoji}>{emoji}</Text>
    </View>
  );
}

const emptyHaloStyles = StyleSheet.create({
  disc: {
    width: 104,
    height: 104,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 48, lineHeight: 56 },
});

function MemberStack({ members }: { members: ListMemberSummary[] }) {
  const shown = members.slice(0, 3);
  return (
    <View
      style={memberStackStyles.row}
      accessibilityLabel={`${members.length} ${members.length === 1 ? "member" : "members"}`}
    >
      {shown.map((m, i) => (
        <View
          key={m.userId}
          style={[memberStackStyles.chip, i > 0 ? memberStackStyles.chipOverlap : null]}
        >
          <Avatar
            name={m.displayName}
            imageUrl={userAvatarImageUrl(m.userId)}
            size="sm"
            // The Avatar's own initials-on-hue colours, like the home row's
            // stack: a list-tinted disc put dark initials at about 1.3:1.
            style={memberStackStyles.avatar}
          />
        </View>
      ))}
    </View>
  );
}

const memberStackStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  chip: {
    borderRadius: tokens.radius.pill,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
  },
  chipOverlap: { marginLeft: -tokens.space.sm },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
  },
  column: { flex: 1 },
  titleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  titleText: { flex: 1, minWidth: 0, gap: tokens.space.xs },
  titleName: {
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.lineHeight.xl,
    letterSpacing: tokens.font.tracking.title,
  },
  sublineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    flexWrap: "wrap",
  },
  subline: { flexShrink: 1 },
  toolbar: {
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
  },
  // Saved-views strip sits directly above the tag chips — the presets, then
  // the granular tags they're built from.
  savedViewsWrap: {
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
  },
  // The tag bar scrolls with the header; while it's out of view the pinned
  // bar's filter chip shows what's filtering.
  tagBarWrap: {
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.sm,
  },
  filterCount: {
    fontVariant: ["tabular-nums"],
    paddingHorizontal: tokens.space.sm,
  },
  filterKbd: {
    fontVariant: ["tabular-nums"],
    paddingHorizontal: tokens.space.xsm,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
    marginRight: tokens.space.sm,
  },
  emptyHintGroup: {
    alignItems: "center",
    gap: tokens.space.sm,
  },
  emptySharedLine: {
    textAlign: "center",
    maxWidth: 320,
  },
  emptyKbdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  emptyKbd: {
    fontWeight: tokens.font.weight.semibold,
    paddingHorizontal: tokens.space.xsm,
    paddingVertical: tokens.space.xxs,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
    fontVariant: ["tabular-nums"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xxl,
  },
  listWrap: { flex: 1 },
  stateScroll: { flexGrow: 1 },
  bar: {
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "transparent",
  },
  // Content slides under the bar once the title has gone: a hairline marks
  // the edge.
  barScrolled: { borderBottomColor: tokens.border.subtle },
  barTitle: { flex: 1, minWidth: 0 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 180,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.accent.default,
    backgroundColor: tokens.accent.muted,
  },
  filterChipLabel: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: tokens.hit,
    paddingLeft: tokens.space.md,
    borderTopLeftRadius: tokens.radius.pill,
    borderBottomLeftRadius: tokens.radius.pill,
  },
  filterChipText: { flexShrink: 1, color: tokens.accent.default },
});
