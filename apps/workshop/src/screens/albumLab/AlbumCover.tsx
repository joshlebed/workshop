// One album tile: the cover opens the album, the corner button adds it to
// (or removes it from) the list being built.

import { Icon, Text, tokens } from "@workshop/ui";
import { memo } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { LabAlbum } from "./model";

interface AlbumCoverProps {
  album: LabAlbum;
  size: number;
  picked: boolean;
  onOpen: (id: string) => void;
  onTogglePick: (id: string) => void;
  /** Hide the title and artist under the cover. */
  bare?: boolean;
}

export const AlbumCover = memo(function AlbumCover({
  album,
  size,
  picked,
  onOpen,
  onTogglePick,
  bare,
}: AlbumCoverProps) {
  const artist = album.artists[0] ?? "";
  return (
    <View style={{ width: size }}>
      <Pressable
        onPress={() => onOpen(album.id)}
        accessibilityRole="button"
        accessibilityLabel={`${album.name}, ${artist}`}
        testID={`album-${album.id}`}
      >
        {album.imageUrl ? (
          <Image
            source={{
              uri: size <= 64 && album.imageSmallUrl ? album.imageSmallUrl : album.imageUrl,
            }}
            style={[styles.image, { width: size, height: size }, picked && styles.picked]}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.image, styles.blank, { width: size, height: size }]} />
        )}
      </Pressable>
      <Pressable
        onPress={() => onTogglePick(album.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={picked ? `Remove ${album.name} from list` : `Add ${album.name} to list`}
        style={[styles.pick, picked && styles.pickOn]}
        testID={`album-pick-${album.id}`}
      >
        <Icon name={picked ? "check" : "plus"} size={16} tone={picked ? "onAccent" : "primary"} />
      </Pressable>
      {bare ? null : (
        <View style={styles.caption}>
          <Text variant="caption" numberOfLines={1}>
            {album.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {artist} · {album.year}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  image: { borderRadius: tokens.radius.sm, backgroundColor: tokens.bg.surface },
  blank: { borderWidth: 1, borderColor: tokens.border.subtle },
  picked: { borderWidth: 3, borderColor: tokens.accent.default },
  pick: {
    position: "absolute",
    top: tokens.space.xs,
    right: tokens.space.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14, 12, 11, 0.78)",
  },
  pickOn: { backgroundColor: tokens.accent.default },
  caption: { paddingTop: tokens.space.xs },
});
