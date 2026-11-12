import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ListColor } from "@workshop/shared";
import { LIST_TEMPLATES, type ListTemplate } from "@workshop/shared/templates";
import {
  Button,
  EmojiBadge,
  Icon,
  type ListColorKey,
  Screen,
  ScreenHeader,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createList } from "../../../../src/api/lists";
import { useAuth } from "../../../../src/hooks/useAuth";
import { pickCoverPhoto } from "../../../../src/lib/coverPhoto";
import { goBack, openListOverHome } from "../../../../src/lib/goBack";

const COLOR_KEYS: readonly ListColorKey[] = [
  "sunset",
  "ocean",
  "forest",
  "grape",
  "rose",
  "sand",
  "slate",
];

const EMOJI_CHOICES = [
  "🎬",
  "📺",
  "📚",
  "💜",
  "✈️",
  "🍿",
  "🎮",
  "🎵",
  "🍔",
  "🌅",
  "🏔️",
  "🎨",
  "🗳️",
  "✅",
  "📝",
];

function lookupTemplate(value: string | string[] | undefined): ListTemplate {
  const raw = Array.isArray(value) ? value[0] : value;
  return LIST_TEMPLATES.find((t) => t.id === raw) ?? LIST_TEMPLATES[LIST_TEMPLATES.length - 1]!;
}

export default function CreateListCustomize() {
  const router = useRouter();
  const params = useLocalSearchParams<{ template?: string; type?: string }>();
  // Back-compat: old links used `type`, new ones use `template`. Treat
  // `type=movie` as the `movie_watchlist` template.
  const templateParam =
    params.template ??
    (params.type
      ? `${Array.isArray(params.type) ? params.type[0] : params.type}_watchlist`
      : undefined);
  const template = lookupTemplate(templateParam);
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(template.defaults.emoji);
  const [color, setColor] = useState<ListColor>(template.defaults.color);
  const [description, setDescription] = useState("");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= 1 && trimmedName.length <= 80;
  const accentHex = tokens.list[color as ListColorKey];
  const requiresSource = Boolean(template.requiresSource);

  const mutation = useMutation({
    mutationFn: () =>
      createList(
        {
          name: trimmedName,
          emoji,
          color,
          itemKind: template.defaults.itemKind,
          modules: template.defaults.modules,
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
          ...(coverPhotoUrl ? { coverPhotoUrl } : {}),
          // Templates like Letterboxd Match attach a fixed-config source
          // automatically — no URL prompt step.
          ...(template.autoSource
            ? { sources: [{ kind: template.autoSource.kind, config: template.autoSource.config }] }
            : {}),
        },
        token,
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      // Home directly beneath the new list, so back goes home (3.8).
      openListOverHome(res.list.id);
    },
    onError: (e) => {
      showToast({
        message: e instanceof Error ? e.message : "Couldn't create list",
        tone: "danger",
      });
    },
  });

  const onSubmit = () => {
    if (requiresSource) {
      router.push({
        pathname: "/create-list/playlist",
        params: {
          template: template.id,
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

  const totalSteps = requiresSource ? 3 : 2;
  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/create-list/type")}
        center={
          <View style={styles.stepDots} accessibilityLabel={`Step 2 of ${totalSteps}`}>
            {Array.from({ length: totalSteps }, (_, i) => `step-${i}`).map((id, i) => (
              <View key={id} style={[styles.stepDot, i < 2 ? styles.stepDotActive : null]} />
            ))}
          </View>
        }
        trailing={<View style={styles.headerSpacer} />}
      />

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <View style={styles.preview}>
          <EmojiBadge emoji={emoji} color={accentHex} size={72} imageUrl={coverPhotoUrl} />
          <View style={styles.previewText}>
            <Text variant="caption" tone="muted" style={styles.previewKind}>
              {template.displayName}
            </Text>
            <Text variant="title" numberOfLines={1} style={styles.previewName}>
              {trimmedName.length > 0 ? trimmedName : "Untitled list"}
            </Text>
            <Text variant="eyebrow" style={styles.previewModules}>
              {template.defaults.modules.join(" · ")}
            </Text>
          </View>
        </View>

        <TextField
          label="Name"
          testID="create-list-name"
          value={name}
          onChangeText={setName}
          placeholder={template.displayName}
          autoFocus
          maxLength={80}
          returnKeyType="next"
        />

        {!requiresSource ? (
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
                aria-pressed={key === color}
                onPress={() => setColor(key)}
                style={({ pressed }) => [styles.colorCell, pressed && styles.colorCellPressed]}
              >
                <View style={[styles.colorSwatch, { backgroundColor: tokens.list[key] }]}>
                  {key === color ? <Icon name="check" size={18} tone="onAccent" /> : null}
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
                aria-pressed={choice === emoji}
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
          <TextField
            accessibilityLabel="Description"
            testID="create-list-description"
            value={description}
            onChangeText={setDescription}
            placeholder="What's this list for?"
            multiline
            maxLength={500}
          />
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <Button
            testID="create-list-submit"
            label={requiresSource ? "Continue" : "Create list"}
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
  stepDots: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    gap: tokens.space.xsm,
    alignItems: "center",
  },
  stepDot: {
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
  // Balances the leading back button so the step dots sit centred.
  headerSpacer: { width: tokens.hit },
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
  previewText: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  previewKind: { letterSpacing: 0.2 },
  previewName: { letterSpacing: -0.4 },
  previewModules: { marginTop: tokens.space.xxs },
  field: { gap: tokens.space.sm },
  fieldLabel: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
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
    width: tokens.hit,
    height: tokens.hit,
    borderRadius: tokens.radius.pill,
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
  coverRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  colorCellPressed: { opacity: 0.8 },
});
