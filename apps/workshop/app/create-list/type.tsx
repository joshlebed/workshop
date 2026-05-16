import type { ListType } from "@workshop/shared";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../../src/lib/goBack";
import { IconButton, type ListColorKey, Screen, Text, tokens } from "../../src/ui/index";

interface TypeOption {
  type: ListType;
  emoji: string;
  label: string;
  description: string;
  color: ListColorKey;
}

const OPTIONS: TypeOption[] = [
  {
    type: "movie",
    emoji: "🎬",
    label: "Movies",
    description: "Films to watch, solo or with someone.",
    color: "sunset",
  },
  {
    type: "tv",
    emoji: "📺",
    label: "TV shows",
    description: "Series to start, finish, or rewatch.",
    color: "ocean",
  },
  {
    type: "book",
    emoji: "📚",
    label: "Books",
    description: "A reading list, shared or otherwise.",
    color: "forest",
  },
  {
    type: "date_idea",
    emoji: "💡",
    label: "Date ideas",
    description: "Plans for time spent together.",
    color: "rose",
  },
  {
    type: "trip",
    emoji: "✈️",
    label: "Trips",
    description: "Places to go, things to do there.",
    color: "grape",
  },
  {
    type: "album_shelf",
    emoji: "📀",
    label: "Album shelf",
    description: "Curate albums from a public Spotify playlist.",
    color: "slate",
  },
  {
    type: "game",
    emoji: "🎮",
    label: "Games",
    description: "Daily game scores. Paste from Wordle, Globle, Satle.",
    color: "ocean",
  },
];

export default function CreateListType() {
  const router = useRouter();

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Cancel"
          onPress={() => goBack("/")}
          testID="create-list-cancel"
        >
          <Text style={styles.backGlyph}>✕</Text>
        </IconButton>
        <View style={styles.stepDots} accessibilityLabel="Step 1 of 2">
          <View style={[styles.stepDot, styles.stepDotActive]} />
          <View style={styles.stepDot} />
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.intro}>
          <Text variant="title" style={styles.lead}>
            What are you collecting?
          </Text>
          <Text tone="secondary" style={styles.tagline}>
            Pick a type. You'll name and skin it next.
          </Text>
        </View>
        <View style={styles.options}>
          {OPTIONS.map((opt) => {
            const accent = tokens.list[opt.color];
            return (
              <Pressable
                key={opt.type}
                testID={`create-list-type-${opt.type}`}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                onPress={() =>
                  router.push({
                    pathname: "/create-list/customize",
                    params: { type: opt.type },
                  })
                }
                style={({
                  pressed,
                  hovered,
                  focused,
                }: {
                  pressed?: boolean;
                  hovered?: boolean;
                  focused?: boolean;
                }) => [
                  styles.option,
                  hovered && styles.optionHovered,
                  focused && styles.optionFocused,
                  pressed && styles.optionPressed,
                ]}
              >
                <View
                  style={[
                    styles.optionBadge,
                    { backgroundColor: `${accent}26`, borderColor: `${accent}3D` },
                  ]}
                >
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                </View>
                <View style={styles.optionText}>
                  <Text variant="label" style={styles.optionLabel}>
                    {opt.label}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {opt.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.md,
  },
  step: { letterSpacing: 0.3, fontVariant: ["tabular-nums"] },
  stepDots: { flexDirection: "row", gap: 6, alignItems: "center" },
  stepDot: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  intro: { gap: tokens.space.xs, paddingHorizontal: tokens.space.sm },
  lead: { letterSpacing: -0.4 },
  tagline: { fontSize: tokens.font.size.md, lineHeight: 22 },
  options: { gap: tokens.space.xs },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.lg,
  },
  optionHovered: { backgroundColor: tokens.bg.surface },
  optionFocused: {
    backgroundColor: tokens.bg.surface,
    outlineWidth: 0,
    boxShadow: `0 0 0 1.5px ${tokens.accent.default}`,
  },
  optionPressed: { backgroundColor: tokens.bg.elevated },
  optionBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionEmoji: { fontSize: 26, lineHeight: 30 },
  optionText: { flex: 1, gap: 2, minWidth: 0 },
  optionLabel: { fontSize: tokens.font.size.md },
});
