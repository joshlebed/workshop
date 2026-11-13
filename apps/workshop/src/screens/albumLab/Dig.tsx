// Dig: one album at a time. Pick a starting point (a vibe, a genre, an album),
// then keep or skip; what you keep steers what comes next and goes on the list.

import { Button, Card, Chip, layout, screenColumnStyle, Text, tokens } from "@workshop/ui";
import { useMemo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AlbumCover } from "./AlbumCover";
import { countBy, type DigState, digQueue, EMPTY_DIG, genreColor, type LabAlbum } from "./model";

const PRESETS: { label: string; dig: Partial<DigState> }[] = [
  { label: "Late night, dark", dig: { vibes: ["late-night", "dark"] } },
  { label: "Sunny and warm", dig: { vibes: ["sunny", "warm"] } },
  { label: "Chill and dreamy", dig: { vibes: ["chill", "dreamy"] } },
  { label: "Hype", dig: { vibes: ["hype", "party"] } },
  { label: "Rediscover: saved before 2020", dig: { savedBeforeYear: 2020 } },
];

interface DigProps {
  /** Albums matching the current search. */
  albums: LabAlbum[];
  /** The whole library, for looking up the seed and the vibe list. */
  library: LabAlbum[];
  picked: string[];
  dig: DigState | null;
  /** Vibes and genres chosen on the start screen, before a dig begins. */
  draft: DigState;
  onDraft: (draft: DigState) => void;
  onDig: (dig: DigState | null) => void;
  onOpen: (id: string) => void;
  onTogglePick: (id: string) => void;
  onKeep: (id: string) => void;
}

export function Dig({
  albums,
  library,
  picked,
  dig,
  draft,
  onDraft,
  onDig,
  onOpen,
  onTogglePick,
  onKeep,
}: DigProps) {
  const vibes = useMemo(() => countBy(library, (a) => a.vibes), [library]);
  const genres = useMemo(() => countBy(library, (a) => (a.genre ? [a.genre] : [])), [library]);
  const queue = useMemo(() => (dig ? digQueue(albums, dig, picked) : []), [albums, dig, picked]);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  if (!dig) {
    return (
      <ScrollView
        contentContainerStyle={[styles.content, screenColumnStyle]}
        testID="album-dig-start"
      >
        <Text variant="heading">Dig through your library</Text>
        <Text tone="secondary">
          Pick a starting point. You get one album at a time: keep it or skip it, and the next picks
          follow what you keep.
        </Text>
        <Text variant="eyebrow" tone="muted" style={styles.section}>
          Quick starts
        </Text>
        <View style={styles.wrap}>
          {PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              label={preset.label}
              onPress={() => onDig({ ...EMPTY_DIG, ...preset.dig })}
              testID={`album-dig-preset-${preset.label}`}
            />
          ))}
        </View>
        <Text variant="eyebrow" tone="muted" style={styles.section}>
          Or mix your own
        </Text>
        <View style={styles.wrap}>
          {vibes.map(({ key }) => (
            <Chip
              key={key}
              label={key}
              selected={draft.vibes.includes(key)}
              onPress={() => onDraft({ ...draft, vibes: toggle(draft.vibes, key) })}
              testID={`album-dig-vibe-${key}`}
            />
          ))}
        </View>
        <View style={styles.wrap}>
          {genres.map(({ key }) => (
            <Chip
              key={key}
              label={key}
              selected={draft.genres.includes(key)}
              onPress={() => onDraft({ ...draft, genres: toggle(draft.genres, key) })}
              testID={`album-dig-genre-${key}`}
            />
          ))}
        </View>
        <Button
          label="Start digging"
          onPress={() => onDig({ ...EMPTY_DIG, vibes: draft.vibes, genres: draft.genres })}
          style={styles.section}
          testID="album-dig-go"
        />
        <Text variant="caption" tone="muted">
          You can also open any album and choose "Dig from here".
        </Text>
      </ScrollView>
    );
  }

  const seed = dig.seedId ? library.find((a) => a.id === dig.seedId) : undefined;
  const from = [
    seed ? `like ${seed.name}` : null,
    ...dig.vibes,
    ...dig.genres,
    dig.savedBeforeYear ? `saved before ${dig.savedBeforeYear}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const current = queue[0];
  const step = (id: string, keep: boolean) => {
    onDig({ ...dig, seen: [...dig.seen, id], kept: keep ? [...dig.kept, id] : dig.kept });
    if (keep) onKeep(id);
  };
  const matched = seed ? seed.vibes : dig.vibes;

  return (
    <ScrollView contentContainerStyle={[styles.content, screenColumnStyle]} testID="album-dig">
      <View style={styles.status}>
        <Text variant="caption" tone="muted" style={styles.statusText} numberOfLines={2}>
          {from || "Whole library"} · {dig.kept.length} kept · {dig.seen.length - dig.kept.length}{" "}
          skipped · {queue.length} left
        </Text>
        <Pressable
          onPress={() => onDig(null)}
          hitSlop={8}
          accessibilityRole="button"
          testID="album-dig-reset"
        >
          <Text variant="label" tone="secondary">
            Start over
          </Text>
        </Pressable>
      </View>
      {current ? (
        <Card style={styles.card} testID="album-dig-card">
          <Pressable
            onPress={() => onOpen(current.id)}
            accessibilityRole="button"
            accessibilityLabel="Album details"
          >
            {current.imageUrl ? (
              <Image
                source={{ uri: current.imageUrl }}
                style={styles.cover}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.cover, styles.blank]} />
            )}
          </Pressable>
          <Text variant="title" headerRole={2} numberOfLines={2} testID="album-dig-title">
            {current.name}
          </Text>
          <Text tone="secondary" numberOfLines={1}>
            {current.artists.join(", ")} · {current.year}
          </Text>
          <View style={styles.genre}>
            <View style={[styles.dot, { backgroundColor: genreColor(current.genre) }]} />
            <Text variant="caption" tone="secondary">
              {[current.genre, current.subgenre].filter(Boolean).join(" · ") || "Not tagged yet"}
            </Text>
          </View>
          <View style={styles.wrap}>
            {current.vibes.map((vibe) => (
              <View key={vibe} style={[styles.tag, matched.includes(vibe) && styles.tagHit]}>
                <Text variant="caption" tone={matched.includes(vibe) ? "onAccent" : "secondary"}>
                  {vibe}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <Button
              label="Skip"
              variant="secondary"
              size="lg"
              onPress={() => step(current.id, false)}
              style={styles.action}
              testID="album-dig-skip"
            />
            <Button
              label="Keep"
              size="lg"
              onPress={() => step(current.id, true)}
              style={styles.action}
              testID="album-dig-keep"
            />
          </View>
        </Card>
      ) : (
        <Card>
          <Text variant="heading">That's everything</Text>
          <Text tone="secondary">No more albums match. {dig.kept.length} kept.</Text>
        </Card>
      )}
      {queue.length > 1 ? (
        <>
          <Text variant="eyebrow" tone="muted" style={styles.section}>
            Coming up
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.upNext}
          >
            {queue.slice(1, 9).map((album) => (
              <AlbumCover
                key={album.id}
                album={album}
                size={88}
                picked={pickedSet.has(album.id)}
                onOpen={onOpen}
                onTogglePick={onTogglePick}
              />
            ))}
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.sm,
  },
  section: { marginTop: tokens.space.md },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  status: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  statusText: { flex: 1 },
  card: { gap: tokens.space.sm, alignItems: "center" },
  cover: {
    width: 260,
    height: 260,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  blank: { borderWidth: 1, borderColor: tokens.border.subtle },
  genre: { flexDirection: "row", alignItems: "center", gap: tokens.space.xsm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tag: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xxs,
  },
  tagHit: { backgroundColor: tokens.accent.default, borderColor: tokens.accent.default },
  actions: {
    flexDirection: "row",
    gap: tokens.space.md,
    alignSelf: "stretch",
    marginTop: tokens.space.sm,
  },
  action: { flex: 1 },
  upNext: { gap: tokens.space.md },
});
