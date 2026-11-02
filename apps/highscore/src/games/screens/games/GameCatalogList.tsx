// Catalog list for the Games-home "Friends" and "All games" views — games
// grouped by game type (`groupCatalogRows`), each row one-tap addable. A game
// already in My Games opens its board instead. Data, grouping and the add
// mutation live at the call site (GamesHome); this file only renders.

import type { ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, SectionList, StyleSheet, View } from "react-native";
import { bodyType, homeLayout, PixelIcon, PullToRefresh, Text, tokens } from "../../../theme";
import type { CatalogRow, CatalogSection } from "../../lib/catalogSections";

interface GameCatalogListProps {
  sections: CatalogSection[];
  /** Game ids whose add request is in flight (spinner on Add). */
  addingGameIds: string[];
  /** Game ids added this session — the row flips to a "✓ Added" pill. */
  addedGameIds: string[];
  onAdd: (row: CatalogRow) => void;
  /** Tap on a game already in My Games → its board. */
  onOpen: (gameId: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Tail room so the last row clears the floating action bar. */
  bottomInset: number;
  /** Rendered in place of the sections when there are none (loading, empty, error). */
  empty: ReactNode;
  /** testID stem → `${testIDPrefix}-row-${id}` / `-add-${id}` / `-section-${category}`. */
  testIDPrefix: string;
}

export function GameCatalogList({
  sections,
  addingGameIds,
  addedGameIds,
  onAdd,
  onOpen,
  refreshing,
  onRefresh,
  bottomInset,
  empty,
  testIDPrefix,
}: GameCatalogListProps) {
  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.game.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader} testID={`${testIDPrefix}-section-${section.category}`}>
            <Text variant="caption" tone="muted" style={styles.sectionLabel}>
              {section.title}
            </Text>
            <Text variant="caption" tone="muted">
              {section.data.length}
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const adding = addingGameIds.includes(item.game.id);
          const added = addedGameIds.includes(item.game.id);
          const owned = item.inMyGames || added;
          return (
            <Pressable
              accessibilityLabel={item.game.title}
              onPress={owned ? () => onOpen(item.game.id) : undefined}
              disabled={!owned}
              testID={`${testIDPrefix}-row-${item.game.id}`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.row,
                added && styles.rowSelected,
                owned && (pressed || hovered) && styles.rowHover,
              ]}
            >
              <View style={styles.cover}>
                {item.game.iconUrl ? (
                  <Image
                    source={{ uri: item.game.iconUrl }}
                    style={styles.coverImage}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Text style={styles.coverGlyph}>🎮</Text>
                )}
              </View>
              <View style={styles.text}>
                <Text variant="game" numberOfLines={1} style={styles.title}>
                  {item.game.title}
                </Text>
                {item.subtitle ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
              {item.inMyGames ? (
                <View style={styles.ownedCell} testID={`${testIDPrefix}-owned-${item.game.id}`}>
                  <Text variant="label" style={styles.ownedText} numberOfLines={1}>
                    In your games
                  </Text>
                  <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
                </View>
              ) : added ? (
                <View style={styles.ownedCell} testID={`${testIDPrefix}-added-${item.game.id}`}>
                  <Text variant="label" style={styles.ownedText}>
                    ✓ Added
                  </Text>
                  <PixelIcon name="chevron-right" size={16} color={tokens.neon.pink} />
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.game.title}`}
                  onPress={() => onAdd(item)}
                  disabled={adding}
                  testID={`${testIDPrefix}-add-${item.game.id}`}
                  hitSlop={6}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.addBtn,
                    (pressed || hovered) && styles.addBtnHover,
                    adding && styles.addBtnBusy,
                  ]}
                >
                  {adding ? (
                    <ActivityIndicator size="small" color={tokens.accent.default} />
                  ) : (
                    <Text variant="label" style={styles.addLabel}>
                      Add
                    </Text>
                  )}
                </Pressable>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={<View style={styles.empty}>{empty}</View>}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: tokens.space.lg + bottomInset },
        ]}
        testID={`${testIDPrefix}-list`}
      />
    </PullToRefresh>
  );
}

const COVER = 40;

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: homeLayout.contentTopGap,
    gap: tokens.space.sm,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
  },
  sectionLabel: { letterSpacing: 0.4, textTransform: "uppercase" },
  empty: { flex: 1, justifyContent: "center", paddingVertical: tokens.space.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  rowSelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  rowHover: { backgroundColor: tokens.bg.elevated },
  cover: {
    width: COVER,
    height: COVER,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImage: { width: COVER, height: COVER, borderRadius: 0 },
  coverGlyph: { fontSize: 20 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: tokens.text.primary },
  addBtn: {
    minWidth: 64,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  addBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  addBtnBusy: { opacity: 0.8 },
  addLabel: {
    ...bodyType("semibold"),
    color: tokens.neon.pinkTint,
  },
  ownedCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingVertical: tokens.space.sm,
  },
  ownedText: {
    ...bodyType("semibold"),
    color: tokens.text.muted,
  },
});
