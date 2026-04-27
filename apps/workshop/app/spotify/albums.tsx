import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SavedAlbum, SpotifyAlbumSummary } from "@workshop/shared";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  fetchSavedAlbums,
  saveAlbum,
  searchSpotifyAlbums,
  unsaveAlbum,
} from "../../src/api/spotify";
import { useAuth } from "../../src/hooks/useAuth";
import { queryKeys } from "../../src/lib/queryKeys";
import { Button, Card, EmptyState, Text, tokens, useToast } from "../../src/ui/index";

type Mode = "saved" | "search";

export default function SpotifyAlbumsScreen() {
  const { token } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("saved");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const savedQuery = useQuery({
    queryKey: queryKeys.spotify.savedAlbums,
    queryFn: () => fetchSavedAlbums(token),
    enabled: !!token,
  });

  const searchQuery = useQuery({
    queryKey: queryKeys.spotify.search(submittedQuery),
    queryFn: () => searchSpotifyAlbums(submittedQuery, token),
    enabled: !!token && submittedQuery.length > 0,
  });

  const savedSet = new Set((savedQuery.data?.albums ?? []).map((a) => a.spotifyAlbumId));

  const saveMutation = useMutation({
    mutationFn: (id: string) => saveAlbum({ spotifyAlbumId: id }, token),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.spotify.savedAlbums, (prev: typeof savedQuery.data) => {
        if (!prev) return { albums: [res.album] };
        const dedup = prev.albums.filter((a) => a.spotifyAlbumId !== res.album.spotifyAlbumId);
        return { albums: [res.album, ...dedup] };
      });
      toast.showToast({ message: `Saved ${res.album.name}`, tone: "success" });
    },
    onError: (e) => toast.showToast({ message: errorMessage(e), tone: "danger" }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => unsaveAlbum(id, token),
    onSuccess: (_res, id) => {
      queryClient.setQueryData(queryKeys.spotify.savedAlbums, (prev: typeof savedQuery.data) => {
        if (!prev) return prev;
        return { albums: prev.albums.filter((a) => a.spotifyAlbumId !== id) };
      });
      toast.showToast({ message: "Removed from saved albums", tone: "success" });
    },
    onError: (e) => toast.showToast({ message: errorMessage(e), tone: "danger" }),
  });

  const onSearch = () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setSubmittedQuery(trimmed);
    setMode("search");
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="title">Albums</Text>
        <Text tone="secondary">Search Spotify and save albums to your collection.</Text>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search albums or artists"
          placeholderTextColor={tokens.text.muted}
          style={styles.input}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          testID="spotify-search-input"
        />
        <Button label="Search" onPress={onSearch} disabled={query.trim().length === 0} />
      </View>

      <View style={styles.tabs}>
        <TabButton label="Saved" active={mode === "saved"} onPress={() => setMode("saved")} />
        <TabButton
          label={submittedQuery ? `Results: ${submittedQuery}` : "Search"}
          active={mode === "search"}
          onPress={() => setMode("search")}
        />
      </View>

      {mode === "saved" ? (
        <SavedAlbumsList
          query={savedQuery}
          onRemove={(id) => removeMutation.mutate(id)}
          removingId={removeMutation.variables ?? null}
        />
      ) : (
        <SearchResultsList
          query={searchQuery}
          submittedQuery={submittedQuery}
          savedSet={savedSet}
          onSave={(id) => saveMutation.mutate(id)}
          savingId={saveMutation.variables ?? null}
        />
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.tab, active ? styles.tabActive : null]}>
        <Text tone={active ? "primary" : "secondary"} variant="label">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SavedAlbumsList({
  query,
  onRemove,
  removingId,
}: {
  query: ReturnType<typeof useQuery<{ albums: SavedAlbum[] }>>;
  onRemove: (id: string) => void;
  removingId: string | null;
}) {
  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Couldn't load saved albums"
        description={errorMessage(query.error)}
        action={<Button label="Retry" variant="secondary" onPress={() => query.refetch()} />}
      />
    );
  }
  const albums = query.data.albums;
  if (albums.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="No saved albums yet"
          description="Search for an album above and tap Save to start your collection."
        />
      </View>
    );
  }
  return (
    <FlatList
      data={albums}
      keyExtractor={(a) => a.spotifyAlbumId}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={{ height: tokens.space.md }} />}
      renderItem={({ item }) => (
        <AlbumRow
          album={item}
          rightAction={
            <Button
              label="Remove"
              variant="secondary"
              onPress={() => onRemove(item.spotifyAlbumId)}
              loading={removingId === item.spotifyAlbumId}
            />
          }
          subtitle={item.note ?? `Saved ${formatDate(item.savedAt)}`}
        />
      )}
    />
  );
}

function SearchResultsList({
  query,
  submittedQuery,
  savedSet,
  onSave,
  savingId,
}: {
  query: ReturnType<typeof useQuery<{ query: string; results: SpotifyAlbumSummary[] }>>;
  submittedQuery: string;
  savedSet: Set<string>;
  onSave: (id: string) => void;
  savingId: string | null;
}) {
  if (submittedQuery.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Search Spotify"
          description="Type an artist or album name above and hit Search."
        />
      </View>
    );
  }
  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Search failed"
        description={errorMessage(query.error)}
        action={<Button label="Retry" variant="secondary" onPress={() => query.refetch()} />}
      />
    );
  }
  const results = query.data.results;
  if (results.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState title="No results" description={`Nothing for "${submittedQuery}".`} />
      </View>
    );
  }
  return (
    <FlatList
      data={results}
      keyExtractor={(a) => a.spotifyAlbumId}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={{ height: tokens.space.md }} />}
      renderItem={({ item }) => {
        const saved = savedSet.has(item.spotifyAlbumId);
        return (
          <AlbumRow
            album={item}
            subtitle={subtitleFor(item)}
            rightAction={
              saved ? (
                <View style={styles.savedBadge}>
                  <Text tone="secondary" variant="label">
                    Saved
                  </Text>
                </View>
              ) : (
                <Button
                  label="Save"
                  onPress={() => onSave(item.spotifyAlbumId)}
                  loading={savingId === item.spotifyAlbumId}
                />
              )
            }
          />
        );
      }}
    />
  );
}

function AlbumRow({
  album,
  subtitle,
  rightAction,
}: {
  album: SpotifyAlbumSummary;
  subtitle: string | null;
  rightAction: React.ReactNode;
}) {
  return (
    <Card style={styles.albumRow}>
      {album.imageUrl ? (
        <Image
          source={{ uri: album.imageUrl }}
          style={styles.albumArt}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.albumArt, styles.albumArtPlaceholder]}>
          <Text style={{ fontSize: tokens.font.size.xl }}>💿</Text>
        </View>
      )}
      <View style={styles.albumBody}>
        <Text variant="heading" numberOfLines={2}>
          {album.name}
        </Text>
        <Text tone="secondary" numberOfLines={1}>
          {album.artists.join(", ")}
        </Text>
        {subtitle ? (
          <Text tone="muted" variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.albumAction}>{rightAction}</View>
    </Card>
  );
}

function subtitleFor(album: SpotifyAlbumSummary): string | null {
  const parts: string[] = [];
  if (album.releaseDate) parts.push(album.releaseDate.slice(0, 4));
  if (album.totalTracks) parts.push(`${album.totalTracks} tracks`);
  return parts.length ? parts.join(" · ") : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
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
  searchRow: { flexDirection: "row", gap: tokens.space.md, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: tokens.bg.surface,
    borderColor: tokens.border.subtle,
    borderWidth: 1,
    borderRadius: tokens.radius.md,
    color: tokens.text.primary,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    fontSize: tokens.font.size.md,
  },
  tabs: { flexDirection: "row", gap: tokens.space.sm },
  tab: {
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  tabActive: {
    borderColor: tokens.accent.default,
    backgroundColor: tokens.accent.muted,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  albumRow: { flexDirection: "row", gap: tokens.space.md, alignItems: "center" },
  albumArt: { width: 64, height: 64, borderRadius: tokens.radius.md },
  albumArtPlaceholder: {
    backgroundColor: tokens.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  albumBody: { flex: 1, gap: 2 },
  albumAction: { flexShrink: 0 },
  savedBadge: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.elevated,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
});
