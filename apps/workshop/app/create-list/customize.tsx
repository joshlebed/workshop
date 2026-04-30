import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ListColor, ListType } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { createList } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { queryKeys } from "../../src/lib/queryKeys";
import {
  Button,
  Card,
  IconButton,
  type ListColorKey,
  Text,
  tokens,
  useToast,
} from "../../src/ui/index";

const VALID_TYPES: readonly ListType[] = [
  "movie",
  "tv",
  "book",
  "date_idea",
  "trip",
  "album_shelf",
];

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV shows",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
  album_shelf: "Album shelf",
};

const DEFAULT_EMOJI: Record<ListType, string> = {
  movie: "🎬",
  tv: "📺",
  book: "📚",
  date_idea: "💡",
  trip: "✈️",
  album_shelf: "📀",
};

const DEFAULT_COLOR: Record<ListType, ListColor> = {
  movie: "sunset",
  tv: "ocean",
  book: "forest",
  date_idea: "rose",
  trip: "grape",
  album_shelf: "slate",
};

const COLOR_KEYS: readonly ListColorKey[] = [
  "sunset",
  "ocean",
  "forest",
  "grape",
  "rose",
  "sand",
  "slate",
];

const EMOJI_CHOICES = ["🎬", "📺", "📚", "💡", "✈️", "🍿", "🎮", "🎵", "🍔", "🌅", "🏔️", "🎨"];

function parseType(value: string | string[] | undefined): ListType {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (VALID_TYPES as readonly string[]).includes(raw)) return raw as ListType;
  return "date_idea";
}

export default function CreateListCustomize() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const type = parseType(params.type);
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(DEFAULT_EMOJI[type]);
  const [color, setColor] = useState<ListColor>(DEFAULT_COLOR[type]);
  const [description, setDescription] = useState("");

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= 1 && trimmedName.length <= 80;

  const mutation = useMutation({
    mutationFn: () =>
      createList(
        {
          type,
          name: trimmedName,
          emoji,
          color,
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        },
        token,
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace(`/create-list/share?listId=${res.list.id}`);
    },
    onError: (e) => {
      showToast({
        message: e instanceof Error ? e.message : "Couldn't create list",
        tone: "danger",
      });
    },
  });

  const onSubmit = () => {
    if (type === "album_shelf") {
      // Album shelves need a playlist URL to be valid — defer creation
      // to the playlist screen, which calls `createList` with the URL.
      router.push({
        pathname: "/create-list/playlist",
        params: {
          type,
          name: trimmedName,
          emoji,
          color,
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        },
      });
      return;
    }
    mutation.mutate();
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()}>
          <Text style={styles.backGlyph}>‹</Text>
        </IconButton>
        <Text variant="heading">{TYPE_LABEL[type]}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Card style={styles.card} elevated>
          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Name
            </Text>
            <TextInput
              testID="create-list-name"
              value={name}
              onChangeText={setName}
              placeholder="Friday night movies"
              placeholderTextColor={tokens.text.muted}
              autoFocus
              maxLength={80}
              style={styles.input}
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Emoji
            </Text>
            <View style={styles.emojiRow}>
              {EMOJI_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  accessibilityLabel={`Use emoji ${choice}`}
                  accessibilityState={{ selected: choice === emoji }}
                  onPress={() => setEmoji(choice)}
                  style={({ pressed }) => [
                    styles.emojiCell,
                    choice === emoji && styles.emojiCellSelected,
                    pressed && styles.emojiCellPressed,
                  ]}
                >
                  <Text style={styles.emojiGlyph}>{choice}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Color
            </Text>
            <View style={styles.colorRow}>
              {COLOR_KEYS.map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Use color ${key}`}
                  accessibilityState={{ selected: key === color }}
                  onPress={() => setColor(key)}
                  style={({ pressed }) => [
                    styles.colorCell,
                    { backgroundColor: tokens.list[key] },
                    key === color && styles.colorCellSelected,
                    pressed && styles.colorCellPressed,
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Description (optional)
            </Text>
            <TextInput
              testID="create-list-description"
              value={description}
              onChangeText={setDescription}
              placeholder="Anything to know about this list?"
              placeholderTextColor={tokens.text.muted}
              multiline
              maxLength={500}
              style={[styles.input, styles.inputMultiline]}
            />
          </View>
        </Card>
      </ScrollView>

      {/* Submit lives outside the ScrollView so it sticks above the keyboard
          (KeyboardAvoidingView + padding shrinks the KAV; the button stays at
          its bottom edge instead of getting trapped inside scrollable
          content). */}
      <View style={styles.footer}>
        <Button
          testID="create-list-submit"
          label={type === "album_shelf" ? "Continue" : "Create list"}
          size="lg"
          disabled={!canSubmit || mutation.isPending}
          loading={mutation.isPending}
          onPress={onSubmit}
        />
      </View>
    </KeyboardAvoidingView>
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
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.lg,
  },
  footer: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    backgroundColor: tokens.bg.canvas,
  },
  card: { gap: tokens.space.lg },
  field: { gap: tokens.space.sm },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
  emojiCellSelected: { borderColor: tokens.accent.default, backgroundColor: tokens.accent.muted },
  emojiCellPressed: { opacity: 0.7 },
  emojiGlyph: { fontSize: tokens.font.size.lg },
  colorRow: { flexDirection: "row", gap: tokens.space.md },
  colorCell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorCellSelected: { borderColor: tokens.text.primary },
  colorCellPressed: { opacity: 0.8 },
});
