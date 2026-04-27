import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SpotifyTrackSummary } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from "react-native";
import { fetchSpotifyPlaylistTracks, syncPlaylistAlbums } from "../../../src/api/spotify";
import { useAuth } from "../../../src/hooks/useAuth";
import { queryKeys } from "../../../src/lib/queryKeys";
import { Button, Card, EmptyState, Text, tokens, useToast } from "../../../src/ui/index";

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = Array.isArray(id) ? id[0] : id;
  const { token } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const tracks = useQuery({
    queryKey: queryKeys.spotify.playlistTracks(playlistId ?? ""),
    queryFn: () => fetchSpotifyPlaylistTracks(playlistId ?? "", token),
    enabled: !!token && !!playlistId,
  });

  const sync = useMutation({
    mutationFn: () => syncPlaylistAlbums(playlistId ?? "", token),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.spotify.savedAlbums });
      const { newlySavedCount, alreadySavedCount, uniqueAlbumCount } = res;
      toast.showToast({
        message:
          newlySavedCount === 0
            ? `All ${uniqueAlbumCount} albums already saved`
            : `Saved ${newlySavedCount} new album${newlySavedCount === 1 ? "" : "s"}` +
              (alreadySavedCount > 0 ? ` (${alreadySavedCount} already saved)` : ""),
        tone: "success",
      });
    },
    onError: (e) => toast.showToast({ message: errorMessage(e), tone: "danger" }),
  });

  const uniqueAlbumCount = tracks.data
    ? new Set(tracks.data.tracks.map((t) => t.album.spotifyAlbumId)).size
    : 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Button label="← Back" variant="secondary" onPress={() => router.back()} />
        <Text variant="title">Playlist</Text>
      </View>

      {tracks.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : tracks.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load tracks"
            description={errorMessage(tracks.error)}
            action={<Button label="Retry" variant="secondary" onPress={() => tracks.refetch()} />}
          />
        </View>
      ) : (
        <>
          <Card style={styles.summaryCard}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">
                {tracks.data.total} track{tracks.data.total === 1 ? "" : "s"}
              </Text>
              <Text tone="secondary">
                {uniqueAlbumCount} unique album{uniqueAlbumCount === 1 ? "" : "s"}
              </Text>
            </View>
            <Button
              label={sync.isPending ? "Syncing…" : "Sync albums"}
              onPress={() => sync.mutate()}
              loading={sync.isPending}
              disabled={uniqueAlbumCount === 0}
            />
          </Card>

          {tracks.data.tracks.length === 0 ? (
            <View style={styles.center}>
              <EmptyState title="Empty playlist" description="No tracks to sync." />
            </View>
          ) : (
            <FlatList
              data={tracks.data.tracks}
              keyExtractor={(t, idx) => `${t.spotifyTrackId}-${idx}`}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
              renderItem={({ item }) => <TrackRow track={item} />}
              refreshing={tracks.isRefetching}
              onRefresh={() => tracks.refetch()}
            />
          )}
        </>
      )}
    </View>
  );
}

function TrackRow({ track }: { track: SpotifyTrackSummary }) {
  return (
    <Card style={styles.row}>
      {track.album.imageUrl ? (
        <Image
          source={{ uri: track.album.imageUrl }}
          style={styles.art}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.art, styles.placeholder]}>
          <Text style={{ fontSize: tokens.font.size.lg }}>🎵</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1}>{track.name}</Text>
        <Text tone="secondary" variant="caption" numberOfLines={1}>
          {track.artists.join(", ")}
        </Text>
        <Text tone="muted" variant="caption" numberOfLines={1}>
          {track.album.name}
        </Text>
      </View>
    </Card>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.lg,
  },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  row: {
    flexDirection: "row",
    gap: tokens.space.md,
    alignItems: "center",
    padding: tokens.space.md,
  },
  art: { width: 48, height: 48, borderRadius: tokens.radius.sm },
  placeholder: {
    backgroundColor: tokens.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
});
