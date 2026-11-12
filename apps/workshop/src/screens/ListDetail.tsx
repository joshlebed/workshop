import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type {
  Item,
  ItemKind,
  List,
  ListDetailResponse,
  ListItemsResponse,
  ListMemberSummary,
  ListSource,
  MoveItemRequest,
  SavedView,
} from "@workshop/shared";
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
  IconButton,
  type ListColorKey,
  layout,
  openExternalUrl,
  Reveal,
  Screen,
  ScreenHeader,
  Skeleton,
  screenColumnStyle,
  TagFilterBar,
  Text,
  TextField,
  tokens,
  useRevealAfterLoading,
  useToast,
} from "@workshop/ui";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, type TextInputInstance, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
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
  type SectionName,
  stepNeighbours,
  tagChipCounts,
} from "./listDetail/listOps";
import { rankAnchorsOf, rankByIdOf } from "./listDetail/ranks";
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

/**
 * Unified list-detail screen. The shape of the screen falls out of `list.modules`:
 *
 * - `todo` on    → a checkbox on every open row, a Done section below.
 * - `ranking` on → a Ranked block above the open rows.
 * - `sources` on → header refresh button and source provenance.
 *
 * Every write here is optimistic (2.2): the cache changes in `onMutate`, a
 * failure puts it back and says so, and reversible ones offer Undo (2.3).
 * `list.itemKind === "spotify_album"` keeps the album-shelf affordances —
 * body-press opens Spotify, no Edit, and the detected block stays in
 * recency order.
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
  const isSpotifyShelf = itemKind === "spotify_album";
  const hasSources = sources.length > 0 && hasModule(list.modules, "sources");
  const rankingOn = hasModule(list.modules, "ranking");
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

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!primarySource) throw new Error("no source attached");
      return syncSource(list.id, primarySource.id, token);
    },
    onMutate: () => {
      const cur = queryClient.getQueryData<ListItemsResponse>(itemsKey);
      const prevIds = new Set<string>();
      if (cur) {
        for (const it of [...cur.ordered, ...cur.unordered, ...cur.completed]) prevIds.add(it.id);
      }
      beforeRefreshIdsRef.current = prevIds;
    },
    onSuccess: (res) => {
      queryClient.setQueryData<ListItemsResponse>(itemsKey, {
        ordered: res.ordered,
        unordered: res.unordered,
        completed: res.completed,
        suggested: res.suggested,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
      const added = res.addedCount;
      const before = beforeRefreshIdsRef.current ?? new Set<string>();
      const fresh = new Set<string>();
      for (const it of res.unordered) {
        if (!before.has(it.id)) fresh.add(it.id);
      }
      if (fresh.size > 0) setNewItemIds(fresh);
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
    (fn: (d: ListItemsResponse) => ListItemsResponse) => {
      queryClient.setQueryData<ListItemsResponse>(itemsKey, (d) => (d ? fn(d) : d));
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
    { previous?: ListItemsResponse }
  >({
    mutationKey: writeKey,
    mutationFn: async ({ item, intent }) => {
      // The album shelf's detected block stays in recency order, so a demote
      // there uses the legacy shape (clear the rank, keep the shelf's order).
      const body: MoveItemRequest =
        isSpotifyShelf && intent.section === "unranked"
          ? { beforeItemId: null, afterItemId: null }
          : intent;
      return (await moveItem(item.id, body, token)).item;
    },
    onMutate: async ({ item, intent }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<ListItemsResponse>(itemsKey);
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
        next ? applyComplete(d, item.id, selfId) : applyUncomplete(d, item.id, rankingOn),
      );
    },
    onError: (e, { item, next }) => {
      setItems((d) =>
        next ? applyUncomplete(d, item.id, rankingOn) : applyComplete(d, item.id, selfId),
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
      const data = queryClient.getQueryData<ListItemsResponse>(itemsKey);
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
  const orderedRaw = data?.ordered ?? [];
  const unorderedRaw = data?.unordered ?? [];
  const completedRaw = data?.completed ?? [];
  const suggestedRaw = useMemo(() => data?.suggested ?? [], [data?.suggested]);
  const allRows = useMemo(
    () => [...orderedRaw, ...unorderedRaw, ...completedRaw],
    [orderedRaw, unorderedRaw, completedRaw],
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
      return { ordered: orderedRaw, unordered: unorderedRaw, completed: completedRaw };
    }
    const keep = (it: Item) => itemMatches(it, itemFilter);
    return {
      ordered: orderedRaw.filter(keep),
      unordered: unorderedRaw.filter(keep),
      completed: completedRaw.filter(keep),
    };
  }, [orderedRaw, unorderedRaw, completedRaw, itemFilter, anyFilterActive]);

  // Chip counts follow the current result (text search included), in a
  // stable order so a tap never reshuffles the bar (2.11).
  const tagChips = useMemo(
    () =>
      tagChipCounts(allRows, [...filtered.ordered, ...filtered.unordered, ...filtered.completed]),
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
  const rankById = useMemo(() => rankByIdOf(orderedRaw), [orderedRaw]);

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

  const totalRows = filtered.ordered.length + filtered.unordered.length + filtered.completed.length;
  const totalRowsUnfiltered = allRows.length;
  const openCount = orderedRaw.length + unorderedRaw.length;

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
    const inRanked = orderedRaw.findIndex((i) => i.id === item.id);
    const rows = inRanked >= 0 ? orderedRaw : unorderedRaw;
    const i = rows.findIndex((r) => r.id === item.id);
    if (i < 0) return null;
    return {
      section: inRanked >= 0 ? "ranked" : "unranked",
      beforeItemId: rows[i - 1]?.id ?? null,
      afterItemId: rows[i + 1]?.id ?? null,
    };
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
    const open = section !== "completed";
    // Move up / down step past the row the user can see above or below.
    const visible = section === "ordered" ? filtered.ordered : filtered.unordered;
    const stepUp = open ? stepNeighbours(visible, item.id, "up") : null;
    const stepDown = open ? stepNeighbours(visible, item.id, "down") : null;
    const canStep = section === "ordered" || !isSpotifyShelf;
    const block = section === "ordered" ? "ranked" : "unranked";
    // Rank anchors come from the whole Ranked block, never the filtered view (0.8).
    const anchors = rankAnchorsOf(orderedRaw.filter((i) => i.id !== item.id));
    setMenuItem(item);
    setMenuActions({
      ...(todoOn && item.kind !== "spotify_album"
        ? {
            completion: {
              label: open ? copy.mark : copy.unmark,
              onPress: () => toggleComplete(item, open),
            },
          }
        : {}),
      ...(canStep && stepUp
        ? {
            onMoveUp: () => {
              haptics.selection();
              moveMutation.mutate({ item, intent: { section: block, ...stepUp } });
              // The move shows on screen; say it for screen readers.
              announce(`Moved “${item.title}” up`);
            },
          }
        : {}),
      ...(canStep && stepDown
        ? {
            onMoveDown: () => {
              haptics.selection();
              moveMutation.mutate({ item, intent: { section: block, ...stepDown } });
              announce(`Moved “${item.title}” down`);
            },
          }
        : {}),
      ...(open && rankingOn
        ? {
            ...(section !== "ordered" || orderedRaw[0]?.id !== item.id
              ? {
                  onRankTop: () =>
                    moveWithUndo(
                      item,
                      { section: "ranked", beforeItemId: null, afterItemId: anchors.firstId },
                      "Ranked at top",
                    ),
                }
              : {}),
            ...(section !== "ordered" || orderedRaw.at(-1)?.id !== item.id
              ? {
                  onRankBottom: () =>
                    moveWithUndo(
                      item,
                      { section: "ranked", beforeItemId: anchors.lastId, afterItemId: null },
                      "Ranked at bottom",
                    ),
                }
              : {}),
            ...(section === "ordered"
              ? {
                  onUnrank: () =>
                    moveWithUndo(
                      item,
                      { section: "unranked", beforeItemId: null, afterItemId: null },
                      "Removed from ranking",
                    ),
                }
              : {}),
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
    return line(itemCountLabel(openCount));
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
  const canAdd = !isSpotifyShelf;

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
  useShortcuts(
    {
      search: () => filterInputRef.current?.focus?.(),
      new: canAdd ? () => router.push(`/list/${list.id}/add`) : undefined,
    },
    isFocused,
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
        <ListHeader
          list={list}
          members={members}
          accent={accent}
          subline={headerSubline}
          onRename={list.ownerId === user?.id ? renameList : undefined}
          trailing={
            <>
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
        ) : isFilterEmpty ? (
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
        ) : isEmptyAfterFetch ? (
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
            ) : (
              <EmptyState
                motion
                illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                title={kindEmptyCopy(itemKind).title}
                description={kindEmptyCopy(itemKind).description}
                accessibilityLabel={`${kindEmptyCopy(itemKind).title}. ${kindEmptyCopy(itemKind).description}`}
                action={
                  <Button
                    label={kindEmptyCopy(itemKind).action}
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
                        Shared with {members.length - 1} {members.length === 2 ? "other" : "others"}
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
        ) : (
          <Reveal when={itemsRevealed} style={styles.listWrap}>
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
            <ItemList
              ordered={filtered.ordered}
              unordered={filtered.unordered}
              completed={filtered.completed}
              rankById={rankById}
              letterboxdBadgeByItem={letterboxdBadgeByItem}
              listItemKind={itemKind}
              isAlbumShelf={isSpotifyShelf}
              rankingOn={rankingOn}
              todoOn={todoOn}
              copy={copy}
              showCover={itemKind !== "plain" && itemKind !== null}
              openReorderable={!isSpotifyShelf}
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
 * The list's header block (back, settings, badge, name, members + count).
 * Exported so the route can paint it from the home cache before the list's
 * own detail request lands (2.13).
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
  const twoPane = useTwoPane();
  return (
    <>
      <ScreenHeader
        // In the desktop two-pane layout the sidebar is the way between
        // lists, so the list itself has no back button (5.7c).
        leading={twoPane ? "none" : "back"}
        onLeadingPress={() => goBack("/")}
        leadingTestID="list-detail-back"
        trailing={trailing}
      />
      <View style={[styles.titleBlock, screenColumnStyle]}>
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
    </>
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

// Kind-aware copy for the zero-items empty state. The header has already
// told the user which list this is; the empty surface should echo that by
// naming the thing they haven't added yet. Falls back to the generic
// "things you want to remember" line for `plain` / unknown.
function kindEmptyCopy(kind: ItemKind | null): {
  title: string;
  description: string;
  action: string;
} {
  switch (kind) {
    case "movie":
      return {
        title: "No movies yet",
        description: "Add the first one you want to watch.",
        action: "Add a movie",
      };
    case "tv":
      return {
        title: "No shows yet",
        description: "Add the first one you want to watch.",
        action: "Add a show",
      };
    case "book":
      return {
        title: "Nothing on the shelf yet",
        description: "Add the first book you want to read.",
        action: "Add a book",
      };
    case "link":
      return {
        title: "Nothing saved yet",
        description: "Add the first link you want to come back to.",
        action: "Add a link",
      };
    case "spotify_album":
      return {
        title: "Nothing on the shelf yet",
        description: "Pulls from a Spotify playlist when one is connected.",
        action: "Add an album",
      };
    default:
      return {
        title: "Nothing here yet",
        description: "Add the first thing you want to remember.",
        action: "Add an item",
      };
  }
}

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
  // Tag chip bar pins with the toolbar above the scrolling rows, mirroring
  // the day rail: the active filter stays visible while results scroll.
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
});
