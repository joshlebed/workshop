import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, LeaderboardEntry } from "@workshop/shared";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { archiveItem, fetchItem, updateItem } from "../../../../src/api/items";
import { deleteItemScore, fetchItemScores, upsertItemScore } from "../../../../src/api/scores";
import { useAuth } from "../../../../src/hooks/useAuth";
import { errorMessage } from "../../../../src/lib/api";
import { confirm } from "../../../../src/lib/confirm";
import { formatGameDateLabel, localDateKey, shiftDateKey } from "../../../../src/lib/gameDate";
import { goBack } from "../../../../src/lib/goBack";
import { haptics } from "../../../../src/lib/haptics";
import { normalizeExternalUrl, openExternalUrl } from "../../../../src/lib/openUrl";
import { queryKeys } from "../../../../src/lib/queryKeys";
import { formatRelative } from "../../../../src/lib/relativeTime";
import { summarizeScoreBody } from "../../../../src/lib/scoresSummary";
import {
  Avatar,
  Button,
  EmptyState,
  Screen,
  Sheet,
  Text,
  tokens,
  useToast,
} from "../../../../src/ui/index";

const DAY_RAIL_LENGTH = 7;

/**
 * Per-game detail screen for a games list. The hero is the leaderboard for
 * the selected day; the user's own slot doubles as the paste affordance when
 * viewing today and they haven't posted yet. Open-game / Edit / Delete are
 * tucked behind a kebab menu so the social-loop content (scores) owns the
 * surface.
 *
 * Spec rules (preserved from the previous implementation):
 *   - Pasted scores always upload to *today's* bucket regardless of which
 *     day the leaderboard is showing — the date used is the user's local
 *     YYYY-MM-DD.
 *   - Going past today on the day rail is disabled.
 */
export default function GameDetail() {
  const params = useLocalSearchParams<{ id: string; itemId: string }>();
  const listId = Array.isArray(params.id) ? params.id[0] : params.id;
  const itemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [openEditOnMenuClose, setOpenEditOnMenuClose] = useState(false);

  const itemQuery = useQuery({
    queryKey: queryKeys.items.detail(itemId ?? ""),
    queryFn: () => fetchItem(itemId ?? "", token),
    enabled: !!token && !!itemId,
  });

  useEffect(() => {
    if (itemQuery.data?.item) {
      setTitleDraft(itemQuery.data.item.title);
      setUrlDraft(itemQuery.data.item.url ?? "");
    }
  }, [itemQuery.data?.item]);

  const scoresQuery = useQuery({
    queryKey: queryKeys.gameScores.forItem(itemId ?? "", date),
    queryFn: () => fetchItemScores(itemId ?? "", date, token),
    enabled: !!token && !!itemId,
  });

  const myEntry: LeaderboardEntry | undefined = scoresQuery.data?.entries.find(
    (e) => e.userId === user?.id,
  );
  const otherEntries: LeaderboardEntry[] = useMemo(
    () => (scoresQuery.data?.entries ?? []).filter((e) => e.userId !== user?.id),
    [scoresQuery.data, user?.id],
  );

  // Build the day rail: today and the previous 6 days. Hoisted up here (above
  // the early-return guards) so the useMemo runs unconditionally on every
  // render — moving it later would violate rules-of-hooks.
  const dayRail = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    for (let i = 0; i < DAY_RAIL_LENGTH; i++) {
      const key = shiftDateKey(today, -i);
      out.push({ key, label: dayChipLabel(key, today) });
    }
    return out;
  }, [today]);

  const upsertMutation = useMutation({
    mutationFn: (score: string) => {
      if (!itemId) throw new Error("missing item id");
      return upsertItemScore(itemId, { periodKey: today, scoreRaw: score }, token);
    },
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(itemId ?? "", today),
        }),
        listId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.gameScores.forList(listId, today),
            })
          : Promise.resolve(),
      ]);
      showToast({ message: "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => {
      if (!itemId) throw new Error("missing item id");
      return deleteItemScore(itemId, today, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(itemId ?? "", today),
        }),
        listId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.gameScores.forList(listId, today),
            })
          : Promise.resolve(),
      ]);
      showToast({ message: "Score cleared", tone: "default" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!itemId) throw new Error("missing item id");
      const trimmedTitle = titleDraft.trim();
      const normalizedUrl = normalizeExternalUrl(urlDraft);
      return updateItem(itemId, { title: trimmedTitle, url: normalizedUrl }, token);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(itemId ?? "") }),
        listId
          ? queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) })
          : Promise.resolve(),
      ]);
      setEditOpen(false);
      showToast({ message: "Saved", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save"), tone: "danger" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => {
      if (!itemId) throw new Error("missing item id");
      return archiveItem(itemId, token);
    },
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
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't archive"), tone: "danger" });
    },
  });

  if (!itemId || !listId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing ids" />
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
          title="Couldn't load game"
          description={errorMessage(itemQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => itemQuery.refetch()} />}
        />
      </Screen>
    );
  }

  const item = itemQuery.data.item;
  const meta = item.content as { thumbnailUrl?: string; siteName?: string };
  const thumb = typeof meta.thumbnailUrl === "string" ? meta.thumbnailUrl : null;
  const isToday = date === today;
  const totalEntries = scoresQuery.data?.entries.length ?? 0;
  const playedCount = (scoresQuery.data?.entries ?? []).filter(
    (e) => e.scoreRaw != null && e.scoreRaw.length > 0,
  ).length;
  const host = (() => {
    if (!item.url) return null;
    try {
      return new URL(item.url).host.replace(/^www\./, "");
    } catch {
      return item.url;
    }
  })();

  const onDate = (key: string) => {
    setDate(key);
    setDraft("");
  };

  const onOpenGame = () => {
    setMenuOpen(false);
    if (!openExternalUrl(item.url)) {
      showToast({ message: "No URL set on this game.", tone: "danger" });
    }
  };

  const onSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate(trimmed);
  };

  const onClear = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: "Clear today's score?",
      message: "This removes your pasted score for today only.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (ok) clearMutation.mutate();
  };

  const onDelete = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: "Delete this game?",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) archiveMutation.mutate();
  };

  const trimmedTitleDraft = titleDraft.trim();
  const trimmedUrlDraft = urlDraft.trim();
  const editDirty = trimmedTitleDraft !== item.title || trimmedUrlDraft !== (item.url ?? "");
  const canSaveEdit = trimmedTitleDraft.length >= 1 && trimmedTitleDraft.length <= 500 && editDirty;
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showPasteSlot = isToday && !myScore;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <View style={styles.headerNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBack(`/list/${listId}`)}
            testID="game-detail-back"
            hitSlop={10}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <Text style={styles.navGlyph}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Game options"
            onPress={() => setMenuOpen(true)}
            testID="game-detail-menu"
            hitSlop={10}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <Text style={styles.navGlyph}>⋯</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Pressable
            accessibilityRole={item.url ? "link" : undefined}
            accessibilityLabel={item.url ? `Open ${item.title}` : item.title}
            accessibilityHint={item.url ? "Opens the game in your browser" : undefined}
            onPress={item.url ? onOpenGame : undefined}
            disabled={!item.url}
            testID="game-detail-title-link"
            style={({ pressed }) => [
              styles.titleBlock,
              item.url && pressed && styles.titleBlockPressed,
            ]}
          >
            {thumb ? (
              <Image
                source={{ uri: thumb }}
                style={styles.titleBadge}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.titleBadge, styles.titleBadgePlaceholder]}>
                <Text style={styles.titleBadgeGlyph}>🎮</Text>
              </View>
            )}
            <View style={styles.titleText}>
              <Text variant="title" numberOfLines={2} style={styles.titleName}>
                {item.title}
              </Text>
              {host ? (
                <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.hostText}>
                  {host}
                </Text>
              ) : null}
            </View>
            {item.url ? (
              <View style={styles.titleOpenAffordance}>
                <Text style={styles.titleOpenGlyph}>↗</Text>
              </View>
            ) : null}
          </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayRail}
          >
            {dayRail.map((d) => {
              const selected = d.key === date;
              return (
                <Pressable
                  key={d.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${d.label}`}
                  accessibilityState={{ selected }}
                  onPress={() => onDate(d.key)}
                  testID={`game-detail-day-${d.key}`}
                  style={({ pressed }) => [
                    styles.dayChip,
                    selected && styles.dayChipSelected,
                    pressed && styles.dayChipPressed,
                  ]}
                >
                  <Text
                    variant="label"
                    style={[styles.dayChipText, selected && styles.dayChipTextSelected]}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.dayHeader}>
            <Text variant="heading" style={styles.dayTitle}>
              {formatGameDateLabel(date, today)}
            </Text>
            {scoresQuery.isPending ? null : totalEntries === 0 ? (
              <Text variant="caption" tone="muted">
                No members on this list.
              </Text>
            ) : (
              <Text variant="caption" tone="muted">
                {playedCount === 0
                  ? "Nobody has played yet."
                  : `${playedCount} of ${totalEntries} played`}
              </Text>
            )}
          </View>

          {scoresQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.accent.default} />
            </View>
          ) : scoresQuery.isError ? (
            <View style={styles.scoresErrorBlock}>
              <Text tone="danger" style={styles.helper}>
                Couldn't load scores.
              </Text>
              <View style={styles.scoresErrorAction}>
                <Button
                  label="Try again"
                  variant="secondary"
                  size="md"
                  onPress={() => scoresQuery.refetch()}
                  loading={scoresQuery.isFetching}
                  testID="game-detail-scores-retry"
                />
              </View>
            </View>
          ) : (
            <View style={styles.leaderboard}>
              {/* My slot is always at the top: either my filled entry, the
                paste affordance for today, or a quiet "Hasn't played" line
                on past days. */}
              {showPasteSlot ? (
                <PasteSlot
                  draft={draft}
                  onChangeDraft={setDraft}
                  onSubmit={onSubmit}
                  pending={upsertMutation.isPending}
                  userName={user?.displayName ?? null}
                />
              ) : myScore && myEntry ? (
                <LeaderboardEntryRow entry={myEntry} item={item} isMe />
              ) : myEntry ? (
                <UnplayedRow entry={myEntry} isMe />
              ) : null}

              {/* Server sorts: players with a numeric score first (ranked by
                  item.scoreDirection), then unplayed by display name. Trust
                  that order — don't re-sort or re-split client-side. */}
              {otherEntries.map((entry) =>
                entry.scoreRaw != null && entry.scoreRaw.length > 0 ? (
                  <LeaderboardEntryRow key={entry.userId} entry={entry} item={item} isMe={false} />
                ) : (
                  <UnplayedRow key={entry.userId} entry={entry} isMe={false} />
                ),
              )}
            </View>
          )}
        </ScrollView>
      </Screen>

      {/* Menu sheet — Open game / Edit / Delete. Off-stage by default so the
          play-and-watch surface stays calm. */}
      <Sheet
        visible={menuOpen}
        onRequestClose={() => setMenuOpen(false)}
        onClosed={() => {
          if (openEditOnMenuClose) {
            setOpenEditOnMenuClose(false);
            setEditOpen(true);
          }
        }}
        testID="game-detail-menu-sheet"
      >
        <View style={styles.sheetHeader}>
          <Text variant="heading" numberOfLines={1}>
            {item.title}
          </Text>
          {host ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {host}
            </Text>
          ) : null}
        </View>
        <View style={styles.sheetActions}>
          <Button
            testID="game-detail-edit-open"
            label="Edit details"
            onPress={() => {
              setOpenEditOnMenuClose(true);
              setMenuOpen(false);
            }}
          />
          {myEntry?.scoreRaw ? (
            <Button
              testID="game-detail-clear-score"
              label="Clear my score for today"
              variant="ghost"
              onPress={onClear}
              loading={clearMutation.isPending}
            />
          ) : null}
          <View style={styles.sheetDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete game"
            onPress={onDelete}
            testID="game-detail-delete"
            hitSlop={6}
            style={({ pressed }) => [styles.sheetDangerRow, pressed && styles.sheetDangerPressed]}
          >
            <Text style={styles.sheetDangerLabel}>Delete game</Text>
          </Pressable>
        </View>
      </Sheet>

      {/* Edit sheet — title + URL form. Sheet handles keyboard avoidance so
          touches inside the form stay out of the backdrop dismissal target. */}
      <Sheet
        visible={editOpen}
        onRequestClose={() => setEditOpen(false)}
        testID="game-detail-edit-sheet"
      >
        <View style={styles.sheetHeader}>
          <Text variant="heading">Edit game</Text>
        </View>
        <View style={styles.editForm}>
          <View style={styles.field}>
            <Text variant="caption" tone="muted" style={styles.fieldLabel}>
              Title
            </Text>
            <TextInput
              testID="game-detail-title-input"
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="Game name"
              placeholderTextColor={tokens.text.muted}
              maxLength={500}
              style={styles.editInput}
            />
          </View>
          <View style={styles.field}>
            <Text variant="caption" tone="muted" style={styles.fieldLabel}>
              URL
            </Text>
            <TextInput
              testID="game-detail-url-input"
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="https://"
              placeholderTextColor={tokens.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={2048}
              style={styles.editInput}
            />
          </View>
          <Button
            testID="game-detail-save"
            label="Save changes"
            size="lg"
            disabled={!canSaveEdit || saveMutation.isPending}
            loading={saveMutation.isPending}
            onPress={() => saveMutation.mutate()}
          />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function dayChipLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === shiftDateKey(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

interface LeaderboardEntryRowProps {
  entry: LeaderboardEntry;
  item: Item;
  isMe: boolean;
}

function LeaderboardEntryRow({ entry, item, isMe }: LeaderboardEntryRowProps) {
  const name = entry.displayName ?? "Someone";
  // Distill the raw clipboard share into a clean block (per-game grid, URLs
  // stripped). A URL-only share — e.g. Daily Tens' `dailytens.com/?ref=<id>`
  // with no grid — formats to nothing; show "Played" rather than echoing the
  // referral URL as if it were the score. Mirrors the clipboard recap.
  const body = summarizeScoreBody(item, entry);
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`leaderboard-row-${entry.userId}`}>
      <View style={styles.entryHeader}>
        {entry.rank != null ? <RankBadge rank={entry.rank} /> : null}
        <Avatar name={entry.displayName} size="md" />
        <View style={styles.entryNameWrap}>
          <View style={styles.entryNameRow}>
            <Text variant="label" style={styles.entryName} numberOfLines={1}>
              {name}
            </Text>
            {isMe ? (
              <View style={styles.youPill}>
                <Text style={styles.youPillText}>you</Text>
              </View>
            ) : null}
          </View>
          {entry.updatedAt ? (
            <Text variant="caption" tone="muted">
              Posted {formatRelative(entry.updatedAt)}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.scoreFrame}>
        <Text
          style={[styles.scoreText, body ? null : styles.scoreTextMuted]}
          testID={`leaderboard-score-${entry.userId}`}
        >
          {body ?? "Played"}
        </Text>
      </View>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  // Tiered: rank-1 takes the brand attention (filled amber). Rank 2/3 get
  // a softer treatment so the "top three" cohort reads as a group without
  // the leaderboard shouting amber at every glance — Workshop is calm by
  // default, the gold medal earns its loudness.
  const isFirst = rank === 1;
  const isTopThree = rank <= 3;
  return (
    <View
      style={[
        styles.rankBadge,
        isTopThree && !isFirst ? styles.rankBadgeTop3Quiet : null,
        isFirst ? styles.rankBadgeTop1 : null,
      ]}
      testID={`leaderboard-rank-${rank}`}
    >
      <Text
        style={[
          styles.rankBadgeText,
          isTopThree && !isFirst ? styles.rankBadgeTextTop3Quiet : null,
          isFirst ? styles.rankBadgeTextTop1 : null,
        ]}
      >
        {rank}
      </Text>
    </View>
  );
}

function UnplayedRow({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const name = entry.displayName ?? "Someone";
  return (
    <View style={styles.unplayedRow} testID={`leaderboard-row-${entry.userId}`}>
      <Avatar name={entry.displayName} size="md" style={styles.unplayedAvatar} />
      <View style={styles.unplayedNameWrap}>
        <Text variant="label" style={styles.unplayedName} numberOfLines={1}>
          {name}
        </Text>
        {isMe ? (
          <View style={styles.youPill}>
            <Text style={styles.youPillText}>you</Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        {isMe ? "You haven't played yet" : "Hasn't played yet"}
      </Text>
    </View>
  );
}

interface PasteSlotProps {
  draft: string;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  pending: boolean;
  userName: string | null;
}

function PasteSlot({ draft, onChangeDraft, onSubmit, pending, userName }: PasteSlotProps) {
  const empty = draft.trim().length === 0;
  // On web, Cmd/Ctrl+Enter submits — a multiline paste form should never
  // require reaching for the mouse to post. Plain Enter inserts a newline
  // because users routinely paste multi-line results.
  const webProps =
    Platform.OS === "web"
      ? ({
          onKeyDown: (e: {
            key: string;
            metaKey?: boolean;
            ctrlKey?: boolean;
            preventDefault: () => void;
          }) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !empty && !pending) {
              e.preventDefault();
              onSubmit();
            }
          },
        } as Record<string, unknown>)
      : {};
  return (
    <View style={[styles.entry, styles.entryMe, styles.pasteSlot]} testID="game-detail-paste-slot">
      <View style={styles.entryHeader}>
        <Avatar name={userName} size="md" />
        <View style={styles.entryNameWrap}>
          <View style={styles.entryNameRow}>
            <Text variant="label" style={styles.entryName}>
              {userName?.trim() || "You"}
            </Text>
            <View style={styles.youPill}>
              <Text style={styles.youPillText}>you</Text>
            </View>
          </View>
          <Text variant="caption" tone="muted">
            Paste your result to play
          </Text>
        </View>
      </View>
      <TextInput
        testID="game-detail-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={"Paste your result here\ne.g.\n#globle 9 | Avg. Guesses: 7.1\n= 3"}
        placeholderTextColor={tokens.text.muted}
        multiline
        maxLength={2000}
        style={styles.pasteInput}
        {...webProps}
      />
      <View style={styles.pasteActions}>
        {Platform.OS === "web" && !empty ? (
          <Text variant="caption" tone="muted" style={styles.pasteHint}>
            ⌘↩ to post
          </Text>
        ) : null}
        <Button
          label="Post score"
          size="md"
          onPress={onSubmit}
          disabled={empty || pending}
          loading={pending}
          testID="game-detail-paste-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas, paddingTop: tokens.space.xl },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  body: {
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.lg,
  },
  titleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.md,
    marginHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.lg,
  },
  titleBlockPressed: { backgroundColor: tokens.bg.surface },
  titleBadge: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.elevated,
  },
  titleBadgePlaceholder: { alignItems: "center", justifyContent: "center" },
  titleBadgeGlyph: { fontSize: 28, lineHeight: 32 },
  titleText: { flex: 1, minWidth: 0, gap: 4 },
  titleName: { letterSpacing: -0.5, fontSize: 28, lineHeight: 32 },
  hostText: { letterSpacing: 0.1 },
  titleOpenAffordance: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  titleOpenGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    lineHeight: tokens.font.size.md + 2,
  },
  dayRail: {
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.sm,
  },
  dayChip: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: 6,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  dayChipSelected: {
    backgroundColor: tokens.accent.muted,
    borderColor: tokens.accent.default,
  },
  dayChipPressed: { opacity: 0.75 },
  dayChipText: { fontSize: tokens.font.size.sm, color: tokens.text.secondary },
  dayChipTextSelected: { color: tokens.accent.default, fontWeight: tokens.font.weight.semibold },
  dayHeader: {
    paddingHorizontal: tokens.space.xl,
    gap: 2,
  },
  dayTitle: { letterSpacing: -0.2 },
  helper: {
    paddingVertical: tokens.space.lg,
    textAlign: "center",
    paddingHorizontal: tokens.space.xl,
  },
  scoresErrorBlock: {
    gap: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  scoresErrorAction: {
    alignItems: "center",
  },
  leaderboard: {
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  entry: {
    gap: tokens.space.sm,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  entryMe: {
    // Per DESIGN.md "color used to identify a list" — me-row gets a quiet
    // accent tint as its sole signal of "this is you." The "you" pill
    // doubles as a textual label so the highlight isn't color-only.
    backgroundColor: `${tokens.accent.default}14`,
  },
  pasteSlot: {},
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  entryNameWrap: { flex: 1, minWidth: 0, gap: 2 },
  entryNameRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  entryName: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  youPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.accent.muted,
  },
  youPillText: {
    fontSize: 10,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.5,
    color: tokens.accent.default,
    textTransform: "uppercase",
  },
  scoreFrame: {
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
  },
  rankBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
  },
  rankBadgeTop1: {
    backgroundColor: tokens.accent.default,
    borderColor: tokens.accent.default,
  },
  rankBadgeTop3Quiet: {
    borderColor: tokens.accent.default,
    backgroundColor: tokens.accent.muted,
  },
  rankBadgeText: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    color: tokens.text.secondary,
    fontVariant: ["tabular-nums"],
  },
  rankBadgeTextTop1: {
    color: tokens.text.onAccent,
  },
  rankBadgeTextTop3Quiet: {
    color: tokens.accent.default,
  },
  scoreText: {
    color: tokens.text.primary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
  },
  scoreTextMuted: {
    color: tokens.text.muted,
    fontStyle: "italic",
  },
  unplayedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.xs,
  },
  unplayedAvatar: { opacity: 0.5 },
  unplayedNameWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minWidth: 0,
  },
  unplayedName: { fontSize: tokens.font.size.md, color: tokens.text.secondary },
  pasteInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: tokens.font.size.sm + 6,
  },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
  pasteHint: { letterSpacing: 0.3 },
  sheetHeader: {
    gap: 4,
  },
  sheetActions: {
    gap: tokens.space.sm,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginVertical: tokens.space.xs,
  },
  sheetDangerRow: {
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  sheetDangerPressed: { backgroundColor: `${tokens.status.danger}1A` },
  sheetDangerLabel: {
    color: tokens.status.danger,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
  },
  editForm: {
    gap: tokens.space.md,
  },
  field: { gap: tokens.space.xs },
  fieldLabel: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  editInput: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
});
