// Shelves: the library as rows of covers, grouped by a facet (genre, vibe,
// decade…). A shelf opens into a full grid.

import { ActionSheet, Chip, layout, screenColumnStyle, Text, tokens } from "@workshop/ui";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { AlbumCover } from "./AlbumCover";
import {
  buildShelves,
  GROUPS,
  type GroupKey,
  genreColor,
  type LabAlbum,
  type Shelf,
  SORTS,
  type SortKey,
} from "./model";

const ROW_LIMIT = 20;
const ROW_COVER = 124;
const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[];
const SORT_KEYS = Object.keys(SORTS) as SortKey[];

interface ShelvesProps {
  albums: LabAlbum[];
  picked: string[];
  onOpen: (id: string) => void;
  onTogglePick: (id: string) => void;
  onPickMany: (ids: string[]) => void;
}

export function Shelves({ albums, picked, onOpen, onTogglePick, onPickMany }: ShelvesProps) {
  const [group, setGroup] = useState<GroupKey>("genre");
  const [sort, setSort] = useState<SortKey>("saved");
  const [sortOpen, setSortOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const { shelves, hiddenGroups } = useMemo(
    () => buildShelves(albums, group, sort),
    [albums, group, sort],
  );
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const open = openKey === null ? undefined : shelves.find((s) => s.key === openKey);

  const columnWidth = Math.min(width, layout.columnMaxWidth) - 2 * layout.gutter;
  const columns = Math.max(3, Math.floor(columnWidth / 132));
  const gridCover = Math.floor((columnWidth - (columns - 1) * tokens.space.md) / columns);

  const controls = (
    <View style={styles.controls}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {GROUP_KEYS.map((key) => (
          <Chip
            key={key}
            label={GROUPS[key].label}
            selected={group === key}
            onPress={() => {
              setGroup(key);
              setOpenKey(null);
            }}
            testID={`album-lab-group-${key}`}
          />
        ))}
      </ScrollView>
      <View style={styles.sortRow}>
        <Chip
          label={`Sort: ${SORTS[sort].label}`}
          icon="chevron-down"
          onPress={() => setSortOpen(true)}
          testID="album-lab-sort"
        />
        {hiddenGroups > 0 && !open ? (
          <Text variant="caption" tone="muted">
            {hiddenGroups} smaller groups hidden
          </Text>
        ) : null}
      </View>
    </View>
  );

  const shelfHeader = (shelf: Shelf, expanded: boolean) => (
    <View style={styles.shelfHeader}>
      {group === "genre" ? (
        <View style={[styles.dot, { backgroundColor: genreColor(shelf.key) }]} />
      ) : null}
      <Text variant="heading" style={styles.shelfTitle} numberOfLines={1}>
        {shelf.key}
      </Text>
      <Text variant="caption" tone="muted">
        {shelf.albums.length}
      </Text>
      <View style={styles.spacer} />
      <Pressable
        onPress={() => onPickMany(shelf.albums.map((a) => a.id))}
        hitSlop={8}
        accessibilityRole="button"
        testID={`album-lab-add-all-${shelf.key}`}
      >
        <Text variant="label" tone="secondary">
          Add all
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setOpenKey(expanded ? null : shelf.key)}
        hitSlop={8}
        accessibilityRole="button"
        testID={`album-lab-shelf-toggle-${shelf.key}`}
      >
        <Text variant="label" tone="secondary">
          {expanded ? "All shelves" : "See all"}
        </Text>
      </Pressable>
    </View>
  );

  const sortSheet = (
    <ActionSheet
      visible={sortOpen}
      onClose={() => setSortOpen(false)}
      title="Sort albums"
      items={SORT_KEYS.map((key) => ({
        label: SORTS[key].label,
        detail: key === sort ? "Current" : undefined,
        onPress: () => setSort(key),
      }))}
    />
  );

  if (open) {
    return (
      <>
        <FlatList
          key={`grid-${columns}`}
          data={open.albums}
          keyExtractor={(a) => a.id}
          numColumns={columns}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.content, screenColumnStyle]}
          ListHeaderComponent={
            <>
              {controls}
              {shelfHeader(open, true)}
            </>
          }
          renderItem={({ item }) => (
            <AlbumCover
              album={item}
              size={gridCover}
              picked={pickedSet.has(item.id)}
              onOpen={onOpen}
              onTogglePick={onTogglePick}
            />
          )}
          testID="album-lab-shelf-grid"
        />
        {sortSheet}
      </>
    );
  }

  return (
    <>
      <FlatList
        key="shelves"
        data={shelves}
        keyExtractor={(s) => s.key}
        contentContainerStyle={[styles.content, screenColumnStyle]}
        ListHeaderComponent={controls}
        ListEmptyComponent={
          <Text tone="muted" style={styles.empty}>
            Nothing matches that search.
          </Text>
        }
        initialNumToRender={4}
        windowSize={5}
        renderItem={({ item: shelf }) => (
          <View style={styles.shelf} testID={`album-lab-shelf-${shelf.key}`}>
            {shelfHeader(shelf, false)}
            <FlatList
              horizontal
              data={shelf.albums.slice(0, ROW_LIMIT)}
              keyExtractor={(a) => a.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
              initialNumToRender={5}
              renderItem={({ item }) => (
                <AlbumCover
                  album={item}
                  size={ROW_COVER}
                  picked={pickedSet.has(item.id)}
                  onOpen={onOpen}
                  onTogglePick={onTogglePick}
                />
              )}
              ListFooterComponent={
                shelf.albums.length > ROW_LIMIT ? (
                  <Pressable
                    onPress={() => setOpenKey(shelf.key)}
                    style={styles.more}
                    accessibilityRole="button"
                  >
                    <Text tone="secondary">+{shelf.albums.length - ROW_LIMIT} more</Text>
                  </Pressable>
                ) : undefined
              }
            />
          </View>
        )}
        testID="album-lab-shelves"
      />
      {sortSheet}
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingBottom: tokens.space.xxl },
  controls: { gap: tokens.space.sm, paddingBottom: tokens.space.sm },
  chips: { gap: tokens.space.sm },
  sortRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  shelf: { paddingTop: tokens.space.md },
  shelfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  shelfTitle: { textTransform: "capitalize", flexShrink: 1 },
  spacer: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { gap: tokens.space.md },
  gridRow: { gap: tokens.space.md, paddingBottom: tokens.space.md },
  more: {
    width: ROW_COVER,
    height: ROW_COVER,
    marginLeft: tokens.space.md,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { textAlign: "center", paddingVertical: tokens.space.xxl },
});
