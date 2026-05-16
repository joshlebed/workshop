import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ListColor, ListType } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createList } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { pickCoverPhoto } from "../../src/lib/coverPhoto";
import { goBack } from "../../src/lib/goBack";
import { queryKeys } from "../../src/lib/queryKeys";
import {
  Button,
  IconButton,
  type ListColorKey,
  Screen,
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
  "game",
];

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV shows",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
  album_shelf: "Album shelf",
  game: "Games",
};

const DEFAULT_EMOJI: Record<ListType, string> = {
  movie: "🎬",
  tv: "📺",
  book: "📚",
  date_idea: "💡",
  trip: "✈️",
  album_shelf: "📀",
  game: "🎮",
};

const DEFAULT_COLOR: Record<ListType, ListColor> = {
  movie: "sunset",
  tv: "ocean",
  book: "forest",
  date_idea: "rose",
  trip: "grape",
  album_shelf: "slate",
  game: "ocean",
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

const NAME_PLACEHOLDERS: Record<ListType, string> = {
  movie: "Friday night movies",
  tv: "Shows we're both watching",
  book: "Books for the trip",
  date_idea: "Date ideas",
  trip: "Summer trip",
  album_shelf: "Album shelf",
  game: "Daily games",
};

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
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= 1 && trimmedName.length <= 80;
  const accentHex = tokens.list[color as ListColorKey];
  const isAlbumShelf = type === "album_shelf";

  const mutation = useMutation({
    mutationFn: () =>
      createList(
        {
          type,
          name: trimmedName,
          emoji,
          color,
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
          ...(coverPhotoUrl ? { coverPhotoUrl } : {}),
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
    if (isAlbumShelf) {
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

  const totalSteps = isAlbumShelf ? 3 : 2;
  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => goBack("/create-list/type")}>
          <Text style={styles.backGlyph}>‹</Text>
        </IconButton>
        <View style={styles.stepDots} accessibilityLabel={`Step 2 of ${totalSteps}`}>
          {Array.from({ length: totalSteps }, (_, i) => `step-${i}`).map((id, i) => (
            <View key={id} style={[styles.stepDot, i < 2 ? styles.stepDotActive : null]} />
          ))}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <View style={styles.preview}>
          {coverPhotoUrl ? (
            <Image
              source={{ uri: coverPhotoUrl }}
              style={styles.previewBadge}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.previewBadge, { backgroundColor: `${accentHex}26` }]}>
              <Text style={styles.previewEmoji}>{emoji}</Text>
            </View>
          )}
          <View style={styles.previewText}>
            <Text variant="caption" tone="muted" style={styles.previewKind}>
              {TYPE_LABEL[type]}
            </Text>
            <Text variant="title" numberOfLines={1} style={styles.previewName}>
              {trimmedName.length > 0 ? trimmedName : "Untitled list"}
            </Text>
          </View>
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary" style={styles.fieldLabel}>
            Name
          </Text>
          <TextInput
            testID="create-list-name"
            value={name}
            onChangeText={setName}
            placeholder={NAME_PLACEHOLDERS[type]}
            placeholderTextColor={tokens.text.muted}
            autoFocus
            maxLength={80}
            style={styles.input}
            returnKeyType="next"
          />
        </View>

        {!isAlbumShelf ? (
          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text variant="label" tone="secondary" style={styles.fieldLabel}>
                Cover photo
              </Text>
              <Text variant="caption" tone="muted">
                Optional
              </Text>
            </View>
            <View style={styles.coverRow}>
              <Button
                testID="create-list-cover-pick"
                label={coverPhotoUrl ? "Change photo" : "Add a photo"}
                variant="secondary"
                size="md"
                onPress={async () => {
                  const picked = await pickCoverPhoto();
                  if (picked) setCoverPhotoUrl(picked.dataUrl);
                }}
              />
              {coverPhotoUrl ? (
                <Button
                  testID="create-list-cover-remove"
                  label="Remove"
                  variant="secondary"
                  size="md"
                  onPress={() => setCoverPhotoUrl(null)}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text variant="label" tone="secondary" style={styles.fieldLabel}>
            Look
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
                  key === color && styles.colorCellSelected,
                  pressed && styles.colorCellPressed,
                ]}
              >
                <View style={[styles.colorSwatch, { backgroundColor: tokens.list[key] }]}>
                  {key === color ? (
                    <Text style={styles.colorCheck} tone="onAccent">
                      ✓
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
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
          <View style={styles.fieldLabelRow}>
            <Text variant="label" tone="secondary" style={styles.fieldLabel}>
              Description
            </Text>
            <Text variant="caption" tone="muted">
              Optional
            </Text>
          </View>
          <TextInput
            testID="create-list-description"
            value={description}
            onChangeText={setDescription}
            placeholder="What's this list for?"
            placeholderTextColor={tokens.text.muted}
            multiline
            maxLength={500}
            style={[styles.input, styles.inputMultiline]}
          />
        </View>
      </KeyboardAwareScrollView>

      {/* `KeyboardStickyView` tracks the real keyboard frame (including the
          iOS autocorrect-suggestions bar). Pinning the CTA this way is the
          documented pattern for "sticky button above the keyboard" in
          react-native-keyboard-controller — `KeyboardAvoidingView` with
          `padding` measured the keys-only height and clipped this button
          behind the suggestions strip. */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <Button
            testID="create-list-submit"
            label={isAlbumShelf ? "Continue" : "Create list"}
            size="lg"
            disabled={!canSubmit || mutation.isPending}
            loading={mutation.isPending}
            onPress={onSubmit}
          />
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  scroll: { flex: 1 },
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
  backGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.xl,
  },
  footer: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    backgroundColor: tokens.bg.canvas,
  },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  previewBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  previewEmoji: { fontSize: 32, lineHeight: 36 },
  previewText: { flex: 1, minWidth: 0, gap: 2 },
  previewKind: { letterSpacing: 0.2 },
  previewName: { letterSpacing: -0.4 },
  field: { gap: tokens.space.sm },
  fieldLabel: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.surface,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  emojiCellSelected: { backgroundColor: tokens.accent.muted },
  emojiCellPressed: { opacity: 0.7 },
  emojiGlyph: { fontSize: tokens.font.size.lg },
  colorRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  colorCell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  colorCheck: { fontSize: 14, fontWeight: tokens.font.weight.bold, lineHeight: 16 },
  coverRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  colorCellSelected: {},
  colorCellPressed: { opacity: 0.8 },
});
