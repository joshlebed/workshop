import type { ListColor } from "@workshop/shared";
import { featureCopy, listKind, type ToggleFeature } from "@workshop/shared/listKinds";
import {
  getTemplate,
  LIST_TEMPLATES,
  type ListTemplate,
  templateListName,
} from "@workshop/shared/templates";
import {
  Button,
  EmojiBadge,
  type ListColorKey,
  layout,
  Screen,
  ScreenHeader,
  Switch,
  screenColumnStyle,
  Text,
  TextField,
  tokens,
} from "@workshop/ui";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { ColorChoices, EmojiChoices } from "../../../../src/components/ListLookChoices";
import { useCreateFromTemplate } from "../../../../src/hooks/useCreateFromTemplate";
import { pickCoverPhoto } from "../../../../src/lib/coverPhoto";
import { goBack } from "../../../../src/lib/goBack";
import { useEscapeToClose, useSubmitShortcut } from "../../../../src/lib/shortcuts/useShortcuts";

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
  return LIST_TEMPLATES.find((t) => t.id === raw) ?? getTemplate("blank_list")!;
}

/** The template's own emoji always leads the grid, so it stays selectable. */
function emojiChoicesFor(template: ListTemplate): string[] {
  const own = template.defaults.emoji;
  return [own, ...EMOJI_CHOICES.filter((e) => e !== own)];
}

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default function CreateListCustomize() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    template?: string;
    type?: string;
    prefillUrl?: string;
    prefillText?: string;
    from?: string;
  }>();
  // Back-compat: old links used `type`, new ones use `template`. Treat
  // `type=movie` as the `movie_watchlist` template.
  const templateParam =
    params.template ??
    (params.type
      ? `${Array.isArray(params.type) ? params.type[0] : params.type}_watchlist`
      : undefined);
  const template = lookupTemplate(templateParam);
  // A share carried through "New list" (4.4) rides on to the add surface.
  const carried: Record<string, string> = {};
  for (const key of ["prefillUrl", "prefillText", "from"] as const) {
    const v = pick(params[key]);
    if (v) carried[key] = v;
  }
  const { create, pendingTemplateId } = useCreateFromTemplate();

  // Prefilled, so Create is live at once (4.3).
  const [name, setName] = useState(() => templateListName(template));
  const [emoji, setEmoji] = useState(template.defaults.emoji);
  const [color, setColor] = useState<ListColor>(template.defaults.color);
  const [description, setDescription] = useState("");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  // The template's features, adjustable before the list exists: only the
  // toggles this kind of list offers (`@workshop/shared/listKinds`).
  const offeredFeatures = listKind(template.defaults.itemKind).features;
  const [features, setFeatures] = useState<ToggleFeature[]>(template.defaults.modules);
  const toggleFeature = (f: ToggleFeature) =>
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= 1 && trimmedName.length <= 80;
  const accentHex = tokens.list[color as ListColorKey];
  const requiresSource = Boolean(template.requiresSource);

  const pending = pendingTemplateId !== null;
  const onSubmit = () => {
    if (!canSubmit || pending) return;
    if (requiresSource) {
      router.push({
        pathname: "/create-list/playlist",
        params: {
          template: template.id,
          name: trimmedName,
          emoji,
          color,
          ...(description.trim().length > 0 ? { description: description.trim() } : {}),
          modules: features.join(","),
          step: "3",
          steps: "3",
        },
      });
      return;
    }
    create({
      template,
      overrides: { name: trimmedName, emoji, color, description, coverPhotoUrl, modules: features },
      addParams: carried,
    });
  };

  const totalSteps = requiresSource ? 3 : 2;
  // Web: Escape steps back, ⌘Enter creates (5.7b).
  const isFocused = useIsFocused();
  useEscapeToClose(() => goBack("/create-list/type"), isFocused);
  useSubmitShortcut(onSubmit, isFocused);

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/create-list/type")}
        center={
          <>
            {/* The screen's level-1 heading, for assistive tech only: the
                header shows step dots, and the preview below shows the name. */}
            <Text headerRole={1} style={styles.srOnly}>
              New list
            </Text>
            <View style={styles.stepDots} role="img" accessibilityLabel={`Step 2 of ${totalSteps}`}>
              {Array.from({ length: totalSteps }, (_, i) => `step-${i}`).map((id, i) => (
                <View key={id} style={[styles.stepDot, i < 2 ? styles.stepDotActive : null]} />
              ))}
            </View>
          </>
        }
        trailing={<View style={styles.headerSpacer} />}
      />

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, screenColumnStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <View style={styles.preview}>
          <EmojiBadge emoji={emoji} color={accentHex} size={72} imageUrl={coverPhotoUrl} />
          <View style={styles.previewText}>
            {trimmedName !== template.displayName ? (
              <Text variant="caption" tone="muted">
                {template.displayName}
              </Text>
            ) : null}
            {/* A preview of the name, not a heading (the header holds the one h1). */}
            <Text variant="title" numberOfLines={1} headerRole={false}>
              {trimmedName.length > 0 ? trimmedName : templateListName(template)}
            </Text>
          </View>
        </View>

        <TextField
          label="Name"
          testID="create-list-name"
          value={name}
          onChangeText={setName}
          placeholder={templateListName(template)}
          autoFocus
          selectTextOnFocus
          maxLength={80}
          returnKeyType={requiresSource ? "next" : "done"}
          onSubmitEditing={onSubmit}
        />

        {!requiresSource ? (
          <View style={styles.field}>
            <View style={styles.fieldLabelRow}>
              <Text variant="label" tone="secondary">
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
          <Text variant="label" tone="secondary">
            Look
          </Text>
          <ColorChoices choices={COLOR_KEYS} value={color} onChange={setColor} />
          <EmojiChoices choices={emojiChoicesFor(template)} value={emoji} onChange={setEmoji} />
        </View>

        <View style={styles.field}>
          <View style={styles.fieldLabelRow}>
            <Text variant="label" tone="secondary">
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

        <View style={styles.field} testID="create-list-features">
          <Text variant="label" tone="secondary">
            Features
          </Text>
          {offeredFeatures.map((f) => {
            const copy = featureCopy(template.defaults.itemKind, f);
            return (
              <Switch
                key={f}
                label={copy.label}
                description={copy.description}
                value={features.includes(f)}
                onValueChange={() => toggleFeature(f)}
                testID={`create-list-module-${f}`}
              />
            );
          })}
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={[styles.footer, screenColumnStyle]}>
          <Button
            testID="create-list-submit"
            label={requiresSource ? "Continue" : "Create list"}
            size="lg"
            disabled={!canSubmit || pending}
            loading={pending}
            onPress={onSubmit}
          />
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    borderWidth: 0,
  },
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
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.border.subtle,
  },
  stepDotActive: { backgroundColor: tokens.accent.default },
  // Balances the leading back button so the step dots sit centred.
  headerSpacer: { width: tokens.hit },
  body: {
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.xl,
  },
  footer: {
    paddingHorizontal: layout.gutter,
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
  field: { gap: tokens.space.sm },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  coverRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
});
