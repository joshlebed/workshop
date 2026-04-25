import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchSpotifyStatus } from "../../src/api/spotify";
import { useAuth } from "../../src/hooks/useAuth";
import { useSpotifyConnect } from "../../src/hooks/useSpotifyConnect";
import { queryKeys } from "../../src/lib/queryKeys";
import { Button, Card, EmptyState, Text, tokens, useToast } from "../../src/ui/index";

export default function SpotifyHome() {
  const { token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const statusQuery = useQuery({
    queryKey: queryKeys.spotify.status,
    queryFn: () => fetchSpotifyStatus(token),
    enabled: !!token,
  });
  const connect = useSpotifyConnect();
  const params = useLocalSearchParams<{ spotify?: string }>();
  const flag = Array.isArray(params.spotify) ? params.spotify[0] : params.spotify;

  // After returning from the OAuth callback, the URL gets `?spotify=connected`
  // (web) or the deep link fires on iOS. Either way, refetch.
  useFocusEffect(
    useCallback(() => {
      statusQuery.refetch();
    }, [statusQuery]),
  );

  // One-time toast + URL cleanup when the OAuth round-trip lands us back here.
  useEffect(() => {
    if (!flag) return;
    if (flag === "connected") toast.showToast({ message: "Spotify connected", tone: "success" });
    if (flag === "error") toast.showToast({ message: "Spotify connection failed", tone: "danger" });
    queryClient.invalidateQueries({ queryKey: queryKeys.spotify.status });
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      search.delete("spotify");
      search.delete("reason");
      const query = search.toString();
      const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
      window.history.replaceState({}, "", next);
    } else {
      router.setParams({ spotify: undefined, reason: undefined });
    }
  }, [flag, queryClient, toast, router]);

  if (statusQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (statusQuery.isError) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load Spotify status"
          description={errorMessage(statusQuery.error)}
          action={
            <Button label="Retry" variant="secondary" onPress={() => statusQuery.refetch()} />
          }
        />
      </View>
    );
  }

  const status = statusQuery.data;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title">Spotify</Text>
        <Text tone="secondary">
          {status.connected
            ? `Connected as ${status.spotifyDisplayName ?? status.spotifyUserId}`
            : "Connect your Spotify account to save albums, see what's playing, and sync playlists."}
        </Text>
      </View>

      {!status.connected ? (
        <Card style={styles.card}>
          <Text variant="heading">Connect Spotify</Text>
          <Text tone="secondary">
            We use Spotify's Web API to read your library and playback state, and to add albums to
            your saved list. You can disconnect any time.
          </Text>
          <Button
            label={connect.isStarting ? "Opening Spotify…" : "Connect Spotify"}
            onPress={connect.start}
            loading={connect.isStarting}
          />
          {connect.error ? <Text tone="danger">{errorMessage(connect.error)}</Text> : null}
        </Card>
      ) : (
        <View style={styles.tiles}>
          <Tile
            emoji="💿"
            title="Albums"
            subtitle="Search Spotify and save albums to your collection."
            onPress={() => router.push("/spotify/albums")}
            testID="spotify-tile-albums"
          />
          <Tile
            emoji="▶️"
            title="Now playing"
            subtitle="See what's playing right now and your recent listens."
            onPress={() => router.push("/spotify/now-playing")}
            testID="spotify-tile-now-playing"
          />
          <Tile
            emoji="📂"
            title="Playlists"
            subtitle="Browse your Spotify playlists and sync albums to your list."
            onPress={() => router.push("/spotify/playlists")}
            testID="spotify-tile-playlists"
          />

          <View style={styles.disconnectRow}>
            <Button label="Back home" variant="secondary" onPress={() => router.replace("/")} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Tile({
  emoji,
  title,
  subtitle,
  onPress,
  testID,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.tile}>
        <Text style={styles.tileEmoji}>{emoji}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading">{title}</Text>
          <Text tone="secondary">{subtitle}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  content: {
    padding: tokens.space.xl,
    paddingTop: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  center: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { gap: tokens.space.sm },
  card: { gap: tokens.space.md },
  tiles: { gap: tokens.space.md },
  tile: { flexDirection: "row", alignItems: "center", gap: tokens.space.lg },
  tileEmoji: { fontSize: tokens.font.size.xxl },
  pressed: { opacity: 0.85 },
  disconnectRow: { marginTop: tokens.space.lg },
});
