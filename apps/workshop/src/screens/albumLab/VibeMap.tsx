// Map: every album as a small cover placed on two axes (mood across and
// energy up by default). Pan by scrolling both ways; zoom with the buttons.
// "Add what's in view" picks every album currently on screen.

import { Button, Chip, layout, ScreenColumn, Text, tokens } from "@workshop/ui";
import { memo, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  countBy,
  genreColor,
  type LabAlbum,
  MAP_AXES,
  MAP_WORLD,
  type MapAxis,
  mapLayout,
} from "./model";

const ZOOMS = [0.45, 0.7, 1, 1.5] as const;
const AXIS_KEYS = Object.keys(MAP_AXES) as MapAxis[];

interface VibeMapProps {
  /** The whole library: positions stay put while search only dims tiles. */
  albums: LabAlbum[];
  /** Ids matching the current search. */
  matching: Set<string>;
  picked: string[];
  onOpen: (id: string) => void;
  onPickMany: (ids: string[]) => void;
}

interface TilesProps {
  albums: LabAlbum[];
  points: { x: number; y: number }[];
  zoom: number;
  dimmed: Set<string>;
  picked: Set<string>;
  onOpen: (id: string) => void;
}

const Tiles = memo(function Tiles({ albums, points, zoom, dimmed, picked, onOpen }: TilesProps) {
  const size = MAP_WORLD.tile * zoom;
  return (
    <>
      {albums.map((album, i) => {
        const point = points[i];
        if (!point) return null;
        const uri = album.imageSmallUrl ?? album.imageUrl;
        return (
          <Pressable
            key={album.id}
            onPress={() => onOpen(album.id)}
            disabled={dimmed.has(album.id)}
            accessibilityRole="button"
            accessibilityLabel={`${album.name}, ${album.artists[0] ?? ""}`}
            testID={`album-map-${album.id}`}
            style={[
              styles.tile,
              {
                left: point.x * zoom - size / 2,
                top: point.y * zoom - size / 2,
                width: size,
                height: size,
                borderColor: picked.has(album.id) ? tokens.accent.default : genreColor(album.genre),
                borderWidth: picked.has(album.id) ? 3 : 1.5,
                opacity: dimmed.has(album.id) ? 0.1 : 1,
              },
            ]}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.tileImage} accessibilityIgnoresInvertColors />
            ) : null}
          </Pressable>
        );
      })}
    </>
  );
});

export function VibeMap({ albums, matching, picked, onOpen, onPickMany }: VibeMapProps) {
  const [across, setAcross] = useState<MapAxis>("mood");
  const [up, setUp] = useState<MapAxis>("energy");
  const [zoomIndex, setZoomIndex] = useState(1);
  const [genres, setGenres] = useState<string[]>([]);
  const zoom = ZOOMS[zoomIndex] ?? 1;
  const view = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const points = useMemo(() => mapLayout(albums, across, up), [albums, across, up]);
  const genreCounts = useMemo(() => countBy(albums, (a) => (a.genre ? [a.genre] : [])), [albums]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const dimmed = useMemo(
    () =>
      new Set(
        albums
          .filter(
            (a) => !matching.has(a.id) || (genres.length > 0 && !genres.includes(a.genre ?? "")),
          )
          .map((a) => a.id),
      ),
    [albums, matching, genres],
  );

  const nextAxis = (current: MapAxis, other: MapAxis): MapAxis => {
    const options = AXIS_KEYS.filter((k) => k !== other);
    return options[(options.indexOf(current) + 1) % options.length] ?? current;
  };

  const addInView = () => {
    const { x, y, width, height } = view.current;
    const ids = albums
      .filter((a, i) => {
        const p = points[i];
        if (!p || dimmed.has(a.id)) return false;
        const px = p.x * zoom;
        const py = p.y * zoom;
        return px >= x && px <= x + width && py >= y && py <= y + height;
      })
      .map((a) => a.id);
    onPickMany(ids);
  };

  return (
    <View style={styles.root}>
      <ScreenColumn style={styles.controls}>
        <View style={styles.row}>
          <Chip
            label={`Across: ${MAP_AXES[across].label}`}
            onPress={() => setAcross(nextAxis(across, up))}
            testID="album-map-across"
          />
          <Chip
            label={`Up: ${MAP_AXES[up].label}`}
            onPress={() => setUp(nextAxis(up, across))}
            testID="album-map-up"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {genreCounts.map(({ key, count }) => (
            <Chip
              key={key}
              label={`${key} ${count}`}
              selected={genres.includes(key)}
              onPress={() =>
                setGenres((cur) =>
                  cur.includes(key) ? cur.filter((g) => g !== key) : [...cur, key],
                )
              }
              testID={`album-map-genre-${key}`}
            />
          ))}
        </ScrollView>
      </ScreenColumn>
      <View
        style={styles.viewport}
        onLayout={(e) => {
          view.current.width = e.nativeEvent.layout.width;
          view.current.height = e.nativeEvent.layout.height;
        }}
      >
        <ScrollView
          onScroll={(e) => {
            view.current.y = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={64}
          testID="album-map-scroll-y"
        >
          <ScrollView
            horizontal
            onScroll={(e) => {
              view.current.x = e.nativeEvent.contentOffset.x;
            }}
            scrollEventThrottle={64}
            testID="album-map-scroll-x"
          >
            <View
              style={{ width: MAP_WORLD.width * zoom, height: MAP_WORLD.height * zoom }}
              testID="album-map-world"
            >
              <Tiles
                albums={albums}
                points={points}
                zoom={zoom}
                dimmed={dimmed}
                picked={pickedSet}
                onOpen={onOpen}
              />
            </View>
          </ScrollView>
        </ScrollView>
        <View style={styles.axisX} pointerEvents="none">
          <Text variant="caption" tone="muted">
            {MAP_AXES[across].label} →
          </Text>
        </View>
        <View style={styles.axisY} pointerEvents="none">
          <Text variant="caption" tone="muted">
            ↑ {MAP_AXES[up].label}
          </Text>
        </View>
      </View>
      <ScreenColumn style={styles.footer}>
        <Button
          label="−"
          variant="secondary"
          disabled={zoomIndex === 0}
          onPress={() => setZoomIndex((i) => Math.max(0, i - 1))}
          accessibilityLabel="Zoom out"
          testID="album-map-zoom-out"
        />
        <Button
          label="+"
          variant="secondary"
          disabled={zoomIndex === ZOOMS.length - 1}
          onPress={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}
          accessibilityLabel="Zoom in"
          testID="album-map-zoom-in"
        />
        <View style={styles.spacer} />
        <Button
          label="Add what's in view"
          variant="secondary"
          onPress={addInView}
          testID="album-map-add-view"
        />
      </ScreenColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: {
    paddingHorizontal: layout.gutter,
    gap: tokens.space.sm,
    paddingBottom: tokens.space.sm,
  },
  row: { flexDirection: "row", gap: tokens.space.sm },
  viewport: {
    flex: 1,
    backgroundColor: tokens.bg.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: tokens.border.subtle,
  },
  tile: {
    position: "absolute",
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: tokens.bg.elevated,
  },
  tileImage: { width: "100%", height: "100%" },
  axisX: { position: "absolute", right: tokens.space.sm, bottom: tokens.space.xs },
  axisY: { position: "absolute", left: tokens.space.sm, top: tokens.space.xs },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: layout.gutter,
    paddingVertical: tokens.space.sm,
  },
  spacer: { flex: 1 },
});
