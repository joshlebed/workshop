// Album lab (admin-only experiment): browse a saved Spotify library three
// ways (Shelves, Map, Dig) and build Workshop album lists from it. Data comes
// from `GET /v1/admin/album-library`; the server is the gate, `user.isAdmin`
// only decides what to render.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AlbumLibraryResponse } from "@workshop/shared";
import {
  Button,
  Card,
  Chip,
  layout,
  openExternalUrl,
  Screen,
  ScreenColumn,
  ScreenHeader,
  Sheet,
  Skeleton,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { createAlbumList, fetchAlbumLibrary } from "../../api/albumLibrary";
import { useAuth } from "../../hooks/useAuth";
import { failureMessage } from "../../lib/errorCopy";
import { AlbumCover } from "./AlbumCover";
import { Dig } from "./Dig";
import {
  closestAlbums,
  type DigState,
  EMPTY_DIG,
  filterAlbums,
  genreColor,
  indexAlbums,
} from "./model";
import { Shelves } from "./Shelves";
import { VibeMap } from "./VibeMap";

const MODES = [
  { key: "shelves", label: "Shelves" },
  { key: "map", label: "Map" },
  { key: "dig", label: "Dig" },
] as const;
type Mode = (typeof MODES)[number]["key"];

export default function AlbumLab() {
  const { user, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = Boolean(user?.isAdmin);

  const [mode, setMode] = useState<Mode>("shelves");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dig, setDig] = useState<DigState | null>(null);
  const [digDraft, setDigDraft] = useState<DigState>(EMPTY_DIG);
  const [saving, setSaving] = useState(false);
  const [listName, setListName] = useState("");

  const query = useQuery<AlbumLibraryResponse>({
    queryKey: queryKeys.admin.albumLibrary,
    queryFn: () => fetchAlbumLibrary(token),
    enabled: isAdmin && Boolean(token),
    staleTime: 5 * 60_000,
  });
  const library = useMemo(() => indexAlbums(query.data?.albums ?? []), [query.data]);
  const visible = useMemo(() => filterAlbums(library, search), [library, search]);
  const matching = useMemo(() => new Set(visible.map((a) => a.id)), [visible]);
  const byId = useMemo(() => new Map(library.map((a) => [a.id, a])), [library]);
  const detail = detailId ? byId.get(detailId) : undefined;
  const closest = useMemo(
    () => (detail ? closestAlbums(detail, library, 6) : []),
    [detail, library],
  );
  const guessed = useMemo(
    () => library.filter((a) => a.genre !== null && !a.tagsKnown).length,
    [library],
  );

  const togglePick = useCallback((id: string) => {
    setPicked((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));
  }, []);
  const pickMany = useCallback(
    (ids: string[]) => {
      setPicked((cur) => [...cur, ...ids.filter((id) => !cur.includes(id))]);
      showToast({ message: `${ids.length} album${ids.length === 1 ? "" : "s"} added to the list` });
    },
    [showToast],
  );
  const keep = useCallback((id: string) => {
    setPicked((cur) => (cur.includes(id) ? cur : [...cur, id]));
  }, []);

  const save = useMutation({
    mutationFn: () => createAlbumList({ name: listName.trim(), albumIds: picked }, token),
    onSuccess: async ({ listId, added }) => {
      setSaving(false);
      setPicked([]);
      setListName("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({ message: `Saved ${added} album${added === 1 ? "" : "s"} to a new list` });
      router.push(`/list/${listId}` as Href);
    },
  });

  return (
    <Screen style={styles.root} testID="album-lab">
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="album-lab-close"
        eyebrow="Admin"
        title="Album lab"
        style={styles.header}
      />

      {!isAdmin ? (
        <ScreenColumn style={styles.pad}>
          <Card>
            <Text variant="heading">Admins only</Text>
            <Text tone="secondary">The album lab is only available to Workshop admins.</Text>
          </Card>
        </ScreenColumn>
      ) : query.isError ? (
        <ScreenColumn style={styles.pad}>
          <Card style={styles.gap}>
            <Text tone="danger">{failureMessage(query.error, "Couldn't load your albums.")}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </Card>
        </ScreenColumn>
      ) : query.isLoading ? (
        <ScreenColumn style={styles.loading}>
          <Skeleton.Block height={44} radius={tokens.radius.md} />
          <Skeleton.Block height={160} radius={tokens.radius.lg} />
          <Skeleton.Block height={160} radius={tokens.radius.lg} />
        </ScreenColumn>
      ) : library.length === 0 ? (
        <ScreenColumn style={styles.pad}>
          <Card>
            <Text variant="heading">No albums yet</Text>
            <Text tone="secondary">
              This account has no imported Spotify library. Albums arrive through the import script
              for now.
            </Text>
          </Card>
        </ScreenColumn>
      ) : (
        <>
          <ScreenColumn style={styles.top}>
            <View style={styles.modes}>
              {MODES.map((m) => (
                <Chip
                  key={m.key}
                  label={m.label}
                  selected={mode === m.key}
                  onPress={() => setMode(m.key)}
                  testID={`album-lab-mode-${m.key}`}
                />
              ))}
              <View style={styles.spacer} />
              <Text variant="caption" tone="muted" testID="album-lab-count">
                {search.trim()
                  ? `${visible.length} of ${library.length}`
                  : `${library.length} albums`}
              </Text>
            </View>
            <TextField
              variant="search"
              value={search}
              onChangeText={setSearch}
              onClear={() => setSearch("")}
              placeholder="Search albums, artists, vibes"
              accessibilityLabel="Search albums"
              autoCorrect={false}
              autoCapitalize="none"
              testID="album-lab-search"
            />
            {guessed > 0 ? (
              <Text variant="caption" tone="muted">
                Genre and vibe tags are a model's judgment; {guessed} are guessed from the artist.
              </Text>
            ) : null}
          </ScreenColumn>

          <View style={styles.body}>
            {mode === "shelves" ? (
              <Shelves
                albums={visible}
                picked={picked}
                onOpen={setDetailId}
                onTogglePick={togglePick}
                onPickMany={pickMany}
              />
            ) : mode === "map" ? (
              <VibeMap
                albums={library}
                matching={matching}
                picked={picked}
                onOpen={setDetailId}
                onPickMany={pickMany}
              />
            ) : (
              <Dig
                albums={visible}
                library={library}
                picked={picked}
                dig={dig}
                draft={digDraft}
                onDraft={setDigDraft}
                onDig={setDig}
                onOpen={setDetailId}
                onTogglePick={togglePick}
                onKeep={keep}
              />
            )}
          </View>

          {picked.length > 0 ? (
            <View style={styles.trayWrap} testID="album-lab-tray">
              <ScreenColumn style={styles.tray}>
                <View style={styles.thumbs}>
                  {picked.slice(-5).map((id) => {
                    const uri = byId.get(id)?.imageSmallUrl;
                    return uri ? (
                      <Image
                        key={id}
                        source={{ uri }}
                        style={styles.thumb}
                        accessibilityIgnoresInvertColors
                      />
                    ) : null;
                  })}
                </View>
                <Text variant="label" style={styles.trayCount} testID="album-lab-tray-count">
                  {picked.length} album{picked.length === 1 ? "" : "s"}
                </Text>
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => setPicked([])}
                  testID="album-lab-tray-clear"
                />
                <Button
                  label="Save list"
                  onPress={() => setSaving(true)}
                  testID="album-lab-tray-save"
                />
              </ScreenColumn>
            </View>
          ) : null}
        </>
      )}

      <Sheet
        visible={detail !== undefined}
        onRequestClose={() => setDetailId(null)}
        accessibilityLabel={detail?.name ?? "Album"}
        testID="album-lab-detail"
      >
        {detail ? (
          <View style={styles.sheet}>
            <View style={styles.detailHead}>
              {detail.imageUrl ? (
                <Image
                  source={{ uri: detail.imageUrl }}
                  style={styles.detailCover}
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              <View style={styles.detailText}>
                <Text variant="heading" numberOfLines={3} testID="album-lab-detail-title">
                  {detail.name}
                </Text>
                <Text tone="secondary" numberOfLines={2}>
                  {detail.artists.join(", ")}
                </Text>
                <Text variant="caption" tone="muted">
                  {detail.year} · {detail.albumType} · {detail.trackCount} tracks
                </Text>
                <Text variant="caption" tone="muted">
                  Saved {detail.savedAt.slice(0, 10)}
                </Text>
              </View>
            </View>
            <View style={styles.genre}>
              <View style={[styles.dot, { backgroundColor: genreColor(detail.genre) }]} />
              <Text tone="secondary">
                {[detail.genre, detail.subgenre].filter(Boolean).join(" · ") || "Not tagged yet"}
                {detail.genre !== null && !detail.tagsKnown ? " (guessed from the artist)" : ""}
              </Text>
            </View>
            {detail.vibes.length > 0 ? (
              <Text tone="secondary">{detail.vibes.join(" · ")}</Text>
            ) : null}
            {detail.energy !== null && detail.mood !== null ? (
              <Text variant="caption" tone="muted">
                Energy {detail.energy} of 100 · Mood {detail.mood} of 100 (dark to bright)
              </Text>
            ) : null}
            {detail.tags.length > 0 ? (
              <Text variant="caption" tone="muted" numberOfLines={2}>
                MusicBrainz: {detail.tags.slice(0, 8).join(", ")}
              </Text>
            ) : null}
            <View style={styles.detailActions}>
              <Button
                label={picked.includes(detail.id) ? "Remove from list" : "Add to list"}
                onPress={() => togglePick(detail.id)}
                testID="album-lab-detail-pick"
              />
              <Button
                label="Dig from here"
                variant="secondary"
                onPress={() => {
                  setDig({ ...EMPTY_DIG, seedId: detail.id });
                  setMode("dig");
                  setDetailId(null);
                }}
                testID="album-lab-detail-dig"
              />
              <Button
                label="Open in Spotify"
                variant="secondary"
                onPress={() => openExternalUrl(detail.spotifyUrl)}
                testID="album-lab-detail-spotify"
              />
            </View>
            <Text variant="eyebrow" tone="muted">
              Closest in your library
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.closest}
            >
              {closest.map((album) => (
                <AlbumCover
                  key={album.id}
                  album={album}
                  size={88}
                  picked={picked.includes(album.id)}
                  onOpen={setDetailId}
                  onTogglePick={togglePick}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={saving}
        onRequestClose={() => setSaving(false)}
        accessibilityLabel="Save list"
        testID="album-lab-save"
      >
        <View style={styles.sheet}>
          <Text variant="heading">Save {picked.length} albums as a list</Text>
          <TextField
            label="List name"
            value={listName}
            onChangeText={setListName}
            placeholder="Late night drives"
            maxLength={100}
            autoFocus
            error={save.isError ? failureMessage(save.error, "Couldn't save the list.") : null}
            testID="album-lab-save-name"
          />
          <Button
            label="Create list"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={listName.trim().length === 0 || picked.length > 500}
            testID="album-lab-save-submit"
          />
          {picked.length > 500 ? (
            <Text variant="caption" tone="danger">
              A list holds up to 500 albums from here. Remove some first.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingTop: tokens.space.lg, paddingBottom: tokens.space.sm },
  pad: { paddingHorizontal: layout.gutter },
  gap: { gap: tokens.space.md },
  loading: { paddingHorizontal: layout.gutter, gap: tokens.space.md },
  top: { paddingHorizontal: layout.gutter, gap: tokens.space.sm, paddingBottom: tokens.space.sm },
  modes: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  spacer: { flex: 1 },
  body: { flex: 1 },
  trayWrap: {
    borderTopWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  tray: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: layout.gutter,
    paddingVertical: tokens.space.sm,
  },
  thumbs: { flexDirection: "row" },
  thumb: {
    width: 32,
    height: 32,
    borderRadius: 4,
    marginRight: -8,
    borderWidth: 2,
    borderColor: tokens.bg.surface,
  },
  trayCount: { flex: 1, marginLeft: tokens.space.md },
  sheet: { gap: tokens.space.md, padding: tokens.space.lg },
  detailHead: { flexDirection: "row", gap: tokens.space.md },
  detailCover: { width: 120, height: 120, borderRadius: tokens.radius.md },
  detailText: { flex: 1, gap: tokens.space.xxs },
  genre: { flexDirection: "row", alignItems: "center", gap: tokens.space.xsm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  detailActions: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  closest: { gap: tokens.space.md },
});
