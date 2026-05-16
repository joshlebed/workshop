import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameLeaderboardEntry } from "@workshop/shared";
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
import { KeyboardAvoidingView, KeyboardStickyView } from "react-native-keyboard-controller";
import { deleteItemScore, fetchItemScores, upsertItemScore } from "../../../../src/api/gameScores";
import { archiveItem, fetchItem, updateItem } from "../../../../src/api/items";
import { useAuth } from "../../../../src/hooks/useAuth";
import { errorMessage } from "../../../../src/lib/api";
import { confirm } from "../../../../src/lib/confirm";
import { formatGameDateLabel, localDateKey, shiftDateKey } from "../../../../src/lib/gameDate";
import { goBack } from "../../../../src/lib/goBack";
import { haptics } from "../../../../src/lib/haptics";
import { normalizeExternalUrl, openExternalUrl } from "../../../../src/lib/openUrl";
import { queryKeys } from "../../../../src/lib/queryKeys";
import { formatRelative } from "../../../../src/lib/relativeTime";
import {
  Avatar,
  Button,
  EmptyState,
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

  const myEntry: GameLeaderboardEntry | undefined = scoresQuery.data?.entries.find(
    (e) => e.userId === user?.id,
  );
  const otherEntries: GameLeaderboardEntry[] = useMemo(
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
      return upsertItemScore(itemId, { date: today, score }, token);
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
      <View style={styles.center}>
        <EmptyState title="Missing ids" />
      </View>
    );
  }

  if (itemQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load game"
          description={errorMessage(itemQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => itemQuery.refetch()} />}
        />
      </View>
    );
  }

  const item = itemQuery.data.item;
  const meta = item.metadata as { thumbnailUrl?: string; siteName?: string };
  const thumb = typeof meta.thumbnailUrl === "string" ? meta.thumbnailUrl : null;
  const isToday = date === today;
  const totalEntries = scoresQuery.data?.entries.length ?? 0;
  const playedCount = (scoresQuery.data?.entries ?? []).filter(
    (e) => e.score != null && e.score.length > 0,
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
  const myScore = myEntry?.score?.length ? myEntry.score : null;
  const showPasteSlot = isToday && !myScore;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
        <View style={styles.titleBlock}>
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
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.title}`}
                onPress={onOpenGame}
                disabled={!item.url}
                testID="game-detail-host"
                style={({ pressed }) => [styles.hostRow, pressed && styles.hostRowPressed]}
                hitSlop={6}
              >
                <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.hostText}>
                  {host}
                </Text>
                {item.url ? (
                  <Text variant="caption" tone="muted" style={styles.hostArrow}>
                    →
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        </View>

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
          <Text tone="danger" style={styles.helper}>
            Couldn't load scores.
          </Text>
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
              <LeaderboardEntry entry={myEntry} isMe />
            ) : myEntry ? (
              <UnplayedRow entry={myEntry} isMe />
            ) : null}

            {/* Other members. Played first, then the unplayed quiet rows. */}
            {otherEntries
              .filter((e) => e.score != null && e.score.length > 0)
              .map((entry) => (
                <LeaderboardEntry key={entry.userId} entry={entry} isMe={false} />
              ))}
            {otherEntries
              .filter((e) => e.score == null || e.score.length === 0)
              .map((entry) => (
                <UnplayedRow key={entry.userId} entry={entry} isMe={false} />
              ))}
          </View>
        )}
      </ScrollView>

      {/* Menu sheet — Open game / Edit / Delete. Off-stage by default so the
          play-and-watch surface stays calm. */}
      <Sheet
        visible={menuOpen}
        onRequestClose={() => setMenuOpen(false)}
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
            testID="game-detail-open"
            label="Open game"
            onPress={onOpenGame}
            disabled={!item.url}
          />
          <Button
            testID="game-detail-edit-open"
            label="Edit details"
            variant="secondary"
            onPress={() => {
              setMenuOpen(false);
              setEditOpen(true);
            }}
          />
          {myEntry?.score ? (
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

      {/* Edit sheet — title + URL form. Wrapped in KeyboardStickyView so the
          Save button rides the keyboard rather than getting clipped. */}
      <Sheet
        visible={editOpen}
        onRequestClose={() => setEditOpen(false)}
        testID="game-detail-edit-sheet"
      >
        <View style={styles.sheetHeader}>
          <Text variant="heading">Edit game</Text>
        </View>
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={styles.editForm}>
            <View style={styles.field}>
              <Text variant="label" tone="secondary" style={styles.fieldLabel}>
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
              <Text variant="label" tone="secondary" style={styles.fieldLabel}>
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
        </KeyboardStickyView>
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

interface LeaderboardEntryProps {
  entry: GameLeaderboardEntry;
  isMe: boolean;
}

function LeaderboardEntry({ entry, isMe }: LeaderboardEntryProps) {
  const name = entry.displayName ?? "Someone";
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`leaderboard-row-${entry.userId}`}>
      <View style={styles.entryHeader}>
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
        <Text style={styles.scoreText} testID={`leaderboard-score-${entry.userId}`}>
          {entry.score}
        </Text>
      </View>
    </View>
  );
}

function UnplayedRow({ entry, isMe }: { entry: GameLeaderboardEntry; isMe: boolean }) {
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
        Hasn't played
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
      />
      <View style={styles.pasteActions}>
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
    paddingTop: tokens.space.md,
  },
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
  hostRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hostRowPressed: { opacity: 0.6 },
  hostText: { letterSpacing: 0.1 },
  hostArrow: { fontSize: tokens.font.size.sm, lineHeight: tokens.font.size.sm + 2 },
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
    borderColor: tokens.accent.default,
    backgroundColor: `${tokens.accent.default}0F`,
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
  scoreText: {
    color: tokens.text.primary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
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
  },
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
  fieldLabel: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
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
