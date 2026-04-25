import type { ListType } from "@workshop/shared";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Card, IconButton, Text, tokens } from "../../src/ui/index";

interface TypeOption {
  type: ListType;
  emoji: string;
  label: string;
  description: string;
}

const OPTIONS: TypeOption[] = [
  {
    type: "movie",
    emoji: "🎬",
    label: "Movies",
    description: "Films to watch — solo or with someone.",
  },
  {
    type: "tv",
    emoji: "📺",
    label: "TV shows",
    description: "Series to start, finish, or rewatch.",
  },
  {
    type: "book",
    emoji: "📚",
    label: "Books",
    description: "Reading list, shared or otherwise.",
  },
  {
    type: "date_idea",
    emoji: "💡",
    label: "Date ideas",
    description: "Plans for time spent together.",
  },
  {
    type: "trip",
    emoji: "✈️",
    label: "Trips",
    description: "Places to go, things to do there.",
  },
];

export default function CreateListType() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Cancel"
          onPress={() => router.back()}
          testID="create-list-cancel"
        >
          <Text style={styles.backGlyph}>✕</Text>
        </IconButton>
        <Text variant="heading">New list</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text tone="secondary" style={styles.tagline}>
          Pick a type. You can rename and reskin it next.
        </Text>
        <View style={styles.options}>
          {OPTIONS.map((opt) => (
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
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <Card padded={false} style={styles.optionCard}>
                <View style={styles.optionInner}>
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                  <View style={styles.optionText}>
                    <Text variant="heading">{opt.label}</Text>
                    <Text tone="secondary">{opt.description}</Text>
                  </View>
                  <Text tone="muted" style={styles.optionChevron}>
                    ›
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
  },
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  tagline: { textAlign: "center" },
  options: { gap: tokens.space.md },
  option: { borderRadius: tokens.radius.lg },
  optionPressed: { opacity: 0.85 },
  optionCard: { overflow: "hidden" },
  optionInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
    padding: tokens.space.lg,
  },
  optionEmoji: { fontSize: tokens.font.size.xxl },
  optionText: { flex: 1, gap: 2 },
  optionChevron: { fontSize: tokens.font.size.xl },
});
