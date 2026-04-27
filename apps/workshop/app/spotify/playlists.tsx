import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { fetchSpotifyPlaylists } from "../../src/api/spotify";
import { useAuth } from "../../src/hooks/useAuth";
import { queryKeys } from "../../src/lib/queryKeys";
import { Button, Card, EmptyState, Text, tokens } from "../../src/ui/index";

export default function PlaylistsScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const playlists = useQuery({
    queryKey: queryKeys.spotify.playlists,
    queryFn: () => fetchSpotifyPlaylists(token),
    enabled: !!token,
  });

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="title">Playlists</Text>
        <Text tone="secondary">
          Tap a playlist to view tracks. From there you can sync every album into your saved list.
        </Text>
      </View>

      {playlists.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : playlists.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load playlists"
            description={errorMessage(playlists.error)}
            action={
              <Button label="Retry" variant="secondary" onPress={() => playlists.refetch()} />
            }
          />
        </View>
      ) : playlists.data.playlists.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="No playlists"
            description="Create a playlist on Spotify and pull-to-refresh."
          />
        </View>
      ) : (
        <FlatList
          data={playlists.data.playlists}
          keyExtractor={(p) => p.spotifyPlaylistId}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: tokens.space.md }} />}
          refreshing={playlists.isRefetching}
          onRefresh={() => playlists.refetch()}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open playlist ${item.name}`}
              onPress={() => router.push(`/spotify/playlist/${item.spotifyPlaylistId}`)}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <Card style={styles.row}>
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={styles.art}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.art, styles.placeholder]}>
                    <Text style={{ fontSize: tokens.font.size.xl }}>📂</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="heading" numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text tone="secondary" numberOfLines={1}>
                    {item.ownerDisplayName ?? "—"} · {item.trackCount} tracks
                  </Text>
                  {item.description ? (
                    <Text tone="muted" variant="caption" numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
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
  header: { gap: tokens.space.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  row: { flexDirection: "row", gap: tokens.space.md, alignItems: "center" },
  art: { width: 64, height: 64, borderRadius: tokens.radius.md },
  placeholder: {
    backgroundColor: tokens.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
});
