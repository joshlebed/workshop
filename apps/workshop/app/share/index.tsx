import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListItemsResponse } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchItems } from "../../src/api/items";
import { fetchLists } from "../../src/api/lists";
import { upsertItemScore } from "../../src/api/scores";
import { useAuth } from "../../src/hooks/useAuth";
import { errorMessage } from "../../src/lib/api";
import { localDateKey } from "../../src/lib/gameDate";
import { haptics } from "../../src/lib/haptics";
import { queryKeys } from "../../src/lib/queryKeys";
import {
  detectSharedScore,
  flattenListItems,
  pickSuggestedScoreTarget,
  type ShareScoreTarget,
} from "../../src/lib/shareScoreDetection";
import { Button, Screen, Text, tokens, useToast } from "../../src/ui/index";

interface SharedPayload {
  url: string | null;
  text: string | null;
}

export default function ShareHome() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const payload = readSharedPayload(params);
  const payloadText = payload.text ?? payload.url ?? "";
  const detection = useMemo(() => detectSharedScore(payloadText), [payloadText]);
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  const leaderboardLists = useMemo(() => {
    const data = listsQuery.data?.lists ?? [];
    return [...data]
      .filter((list) => list.modules.includes("leaderboard"))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [listsQuery.data]);

  const itemQueries = useQueries({
    queries: leaderboardLists.map((list) => ({
      queryKey: queryKeys.items.byList(list.id),
      queryFn: (): Promise<ListItemsResponse> => fetchItems(list.id, token),
      enabled: !!token && !!detection,
      staleTime: 30_000,
    })),
  });

  const suggestedTarget = useMemo(() => {
    if (!detection) return null;
    const itemsByListId: Record<string, ReturnType<typeof flattenListItems>> = {};
    leaderboardLists.forEach((list, index) => {
      const data = itemQueries[index]?.data;
      if (data) itemsByListId[list.id] = flattenListItems(data);
    });
    return pickSuggestedScoreTarget(detection, leaderboardLists, itemsByListId);
  }, [detection, itemQueries, leaderboardLists]);

  const suggestionLoading =
    !!detection &&
    (listsQuery.isPending || itemQueries.some((query) => query.isPending || query.isFetching));

  const submitSuggestion = useMutation({
    mutationFn: (target: ShareScoreTarget) =>
      upsertItemScore(
        target.item.id,
        { periodKey: localDateKey(), scoreRaw: detection?.scoreRaw ?? payloadText },
        token,
      ),
    onSuccess: async (_data, target) => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(target.item.id, localDateKey()),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forList(target.list.id, localDateKey()),
        }),
      ]);
      showToast({ message: "Score posted", tone: "success" });
      router.replace(`/list/${target.list.id}/game/${target.item.id}`);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't post score"), tone: "danger" });
    },
  });

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const shareQuery = encodeShareQuery(payload);
  const listTarget = shareQuery
    ? (`/share/pick-list${shareQuery}` as `/share/pick-list?${string}`)
    : "/share/pick-list";
  const leaderboardTarget = shareQuery
    ? (`/share/pick-leaderboard${shareQuery}` as `/share/pick-leaderboard?${string}`)
    : "/share/pick-leaderboard";

  return (
    <Screen style={styles.root} testID="share-home">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          testID="share-home-cancel"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>x</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            Add shared item
          </Text>
          <PayloadPill payload={payload} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {detection ? (
          <DetectedScoreSuggestion
            label={detection.gameLabel}
            target={suggestedTarget}
            loading={suggestionLoading}
            error={listsQuery.isError ? errorMessage(listsQuery.error) : null}
            pending={submitSuggestion.isPending}
            onPost={() => suggestedTarget && submitSuggestion.mutate(suggestedTarget)}
          />
        ) : null}

        <View style={styles.optionGroup}>
          <ActionRow
            testID="share-home-add-list"
            eyebrow="List"
            title="Add to a list"
            subtitle="Choose any list and save this as a normal item."
            glyph="+"
            onPress={() => router.replace(listTarget)}
          />
          <ActionRow
            testID="share-home-add-leaderboard"
            eyebrow="Leaderboard"
            title="Add to a leaderboard"
            subtitle="Choose a leaderboard list, then choose the game."
            glyph="#"
            onPress={() => router.push(leaderboardTarget)}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function readSharedPayload(params: {
  url?: string | string[];
  text?: string | string[];
}): SharedPayload {
  const url = firstParam(params.url);
  const text = firstParam(params.text);
  return {
    url: url && isLikelyUrl(url) ? url : null,
    text: text ?? (url && !isLikelyUrl(url) ? url : null),
  };
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function encodeShareQuery(payload: SharedPayload): string {
  const params = new URLSearchParams();
  if (payload.url) params.set("url", payload.url);
  if (!payload.url && payload.text) params.set("text", payload.text);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function shortHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function PayloadPill({ payload }: { payload: SharedPayload }) {
  const host = shortHost(payload.url);
  const label = host ? `Shared from ${host}` : payload.text ? "Shared text" : "No share payload";
  return (
    <View style={styles.payloadPill} testID="share-home-payload">
      <View style={styles.payloadDot} />
      <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
        {label}
      </Text>
    </View>
  );
}

function DetectedScoreSuggestion({
  label,
  target,
  loading,
  error,
  pending,
  onPost,
}: {
  label: string;
  target: ShareScoreTarget | null;
  loading: boolean;
  error: string | null;
  pending: boolean;
  onPost: () => void;
}) {
  if (error) {
    return (
      <View style={styles.suggestionBox} testID="share-home-detection-error">
        <Text variant="label">{label} score detected</Text>
        <Text variant="caption" tone="muted">
          {error}
        </Text>
      </View>
    );
  }

  if (loading && !target) {
    return (
      <View style={styles.suggestionBox} testID="share-home-detection-loading">
        <View style={styles.loadingRow}>
          <ActivityIndicator color={tokens.accent.default} size="small" />
          <Text variant="label">{label} score detected</Text>
        </View>
        <Text variant="caption" tone="muted">
          Looking for a matching game.
        </Text>
      </View>
    );
  }

  if (!target) {
    return (
      <View style={styles.suggestionBox} testID="share-home-detection-empty">
        <Text variant="label">{label} score detected</Text>
        <Text variant="caption" tone="muted">
          Pick a leaderboard below to choose the game.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.suggestionBox} testID="share-home-detection-suggestion">
      <View style={styles.suggestionHeader}>
        <View style={styles.suggestionText}>
          <Text variant="label">{label} score detected</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            Post to {target.item.title} in {target.list.name}
          </Text>
        </View>
        <Button
          label="Post"
          size="md"
          disabled={pending}
          loading={pending}
          onPress={onPost}
          testID="share-home-post-suggestion"
        />
      </View>
    </View>
  );
}

function ActionRow({
  eyebrow,
  title,
  subtitle,
  glyph,
  onPress,
  testID,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  glyph: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
    >
      <View style={styles.optionGlyph}>
        <Text style={styles.optionGlyphText}>{glyph}</Text>
      </View>
      <View style={styles.optionCopy}>
        <Text variant="caption" tone="muted" style={styles.eyebrow}>
          {eyebrow}
        </Text>
        <Text variant="heading" style={styles.optionTitle}>
          {title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Text style={styles.chevron}>{">"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: tokens.bg.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    paddingRight: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: tokens.space.xs, paddingTop: 4 },
  title: { fontSize: tokens.font.size.xl },
  payloadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    maxWidth: "100%",
  },
  payloadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.accent.default,
  },
  payloadText: { flexShrink: 1 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  suggestionBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  suggestionText: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  optionGroup: { gap: tokens.space.md },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
    minHeight: 92,
  },
  optionRowPressed: { backgroundColor: tokens.bg.surface },
  optionGlyph: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
  },
  optionGlyphText: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.bold,
  },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  optionTitle: { fontSize: tokens.font.size.md },
  chevron: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
});
