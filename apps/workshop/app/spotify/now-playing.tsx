import { useQuery } from "@tanstack/react-query";
import type { SpotifyTrackSummary } from "@workshop/shared";
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, View } from "react-native";
import { fetchNowPlaying, fetchRecentListens } from "../../src/api/spotify";
import { useAuth } from "../../src/hooks/useAuth";
import { queryKeys } from "../../src/lib/queryKeys";
import { Button, Card, EmptyState, Text, tokens } from "../../src/ui/index";

export default function NowPlayingScreen() {
  const { token } = useAuth();
  const nowPlaying = useQuery({
    queryKey: queryKeys.spotify.nowPlaying,
    queryFn: () => fetchNowPlaying(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });
  const recent = useQuery({
    queryKey: queryKeys.spotify.recent,
    queryFn: () => fetchRecentListens(token),
    enabled: !!token,
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title">Now playing</Text>
        <Text tone="secondary">Live playback and your recent listens.</Text>
      </View>

      <View>
        {nowPlaying.isPending ? (
          <Card style={styles.placeholder}>
            <ActivityIndicator color={tokens.accent.default} />
          </Card>
        ) : nowPlaying.isError ? (
          <Card style={styles.placeholder}>
            <Text tone="danger">{errorMessage(nowPlaying.error)}</Text>
            <Button label="Retry" variant="secondary" onPress={() => nowPlaying.refetch()} />
          </Card>
        ) : !nowPlaying.data.track ? (
          <Card style={styles.placeholder}>
            <Text variant="heading">Nothing playing</Text>
            <Text tone="secondary">Open Spotify and start a track.</Text>
            <Button label="Refresh" variant="secondary" onPress={() => nowPlaying.refetch()} />
          </Card>
        ) : (
          <NowPlayingCard
            track={nowPlaying.data.track}
            isPlaying={nowPlaying.data.isPlaying}
            progressMs={nowPlaying.data.progressMs}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text variant="heading">Recent listens</Text>
        {recent.isPending ? (
          <ActivityIndicator color={tokens.accent.default} style={{ marginTop: tokens.space.lg }} />
        ) : recent.isError ? (
          <EmptyState
            title="Couldn't load recents"
            description={errorMessage(recent.error)}
            action={<Button label="Retry" variant="secondary" onPress={() => recent.refetch()} />}
          />
        ) : recent.data.items.length === 0 ? (
          <EmptyState
            title="No recent listens"
            description="Play some tracks on Spotify and check back."
          />
        ) : (
          <FlatList
            data={recent.data.items}
            keyExtractor={(it, idx) => `${it.track.spotifyTrackId}-${it.playedAt}-${idx}`}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
            renderItem={({ item }) => <RecentRow track={item.track} playedAt={item.playedAt} />}
          />
        )}
      </View>
    </ScrollView>
  );
}

function NowPlayingCard({
  track,
  isPlaying,
  progressMs,
}: {
  track: SpotifyTrackSummary;
  isPlaying: boolean;
  progressMs: number | null;
}) {
  const progressPct =
    progressMs != null && track.durationMs > 0
      ? Math.min(100, Math.max(0, (progressMs / track.durationMs) * 100))
      : 0;
  return (
    <Card style={styles.np}>
      <View style={styles.npRow}>
        {track.album.imageUrl ? (
          <Image
            source={{ uri: track.album.imageUrl }}
            style={styles.npArt}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.npArt, styles.npArtPlaceholder]}>
            <Text style={{ fontSize: tokens.font.size.xxl }}>🎵</Text>
          </View>
        )}
        <View style={styles.npBody}>
          <Text tone="muted" variant="caption">
            {isPlaying ? "Playing" : "Paused"}
          </Text>
          <Text variant="heading" numberOfLines={2}>
            {track.name}
          </Text>
          <Text tone="secondary" numberOfLines={1}>
            {track.artists.join(", ")}
          </Text>
          <Text tone="muted" variant="caption" numberOfLines={1}>
            {track.album.name}
          </Text>
        </View>
      </View>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>
      <View style={styles.progressMeta}>
        <Text tone="muted" variant="caption">
          {formatMs(progressMs ?? 0)}
        </Text>
        <Text tone="muted" variant="caption">
          {formatMs(track.durationMs)}
        </Text>
      </View>
    </Card>
  );
}

function RecentRow({ track, playedAt }: { track: SpotifyTrackSummary; playedAt: string }) {
  return (
    <Card style={styles.recent}>
      {track.album.imageUrl ? (
        <Image
          source={{ uri: track.album.imageUrl }}
          style={styles.recentArt}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.recentArt, styles.npArtPlaceholder]}>
          <Text style={{ fontSize: tokens.font.size.lg }}>🎵</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1}>{track.name}</Text>
        <Text tone="secondary" variant="caption" numberOfLines={1}>
          {track.artists.join(", ")}
        </Text>
        <Text tone="muted" variant="caption">
          {formatRelativeTime(playedAt)}
        </Text>
      </View>
    </Card>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return d.toLocaleString();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  content: { padding: tokens.space.xl, paddingTop: tokens.space.xxl, gap: tokens.space.lg },
  header: { gap: tokens.space.xs },
  placeholder: { gap: tokens.space.md, alignItems: "center" },
  section: { gap: tokens.space.md },
  np: { gap: tokens.space.md },
  npRow: { flexDirection: "row", gap: tokens.space.md },
  npArt: { width: 96, height: 96, borderRadius: tokens.radius.md },
  npArtPlaceholder: {
    backgroundColor: tokens.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  npBody: { flex: 1, gap: 2 },
  progressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.bg.elevated,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: tokens.accent.default },
  progressMeta: { flexDirection: "row", justifyContent: "space-between" },
  recent: {
    flexDirection: "row",
    gap: tokens.space.md,
    alignItems: "center",
    padding: tokens.space.md,
  },
  recentArt: { width: 48, height: 48, borderRadius: tokens.radius.sm },
});
