import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { Button, IconButton, Screen, Text, tokens, useToast } from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createItemsBulk } from "../../../../../src/api/items";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { goBack } from "../../../../../src/lib/goBack";
import { parsePasteLines } from "../../../../../src/lib/parsePasteLines";

// Server-side BULK_LIMIT in lists.ts. Mirrored here so the client can chunk
// silently rather than 400 the request. If you bump one, bump both.
const BULK_LIMIT = 50;

/**
 * Bulk-paste flow: a single textarea, one item per line. Strips blanks +
 * leading bullet/number prefixes ("1.", "- ", "* "), de-duplicates within
 * the paste, and POSTs in chunks of 50. Designed for the activation moment
 * where a couple has 15 movies in their head and types them one at a time
 * today — one paste replaces fifteen taps.
 *
 * No external enrichment in this revision; items land as raw titles with
 * the unordered section. TMDB / Google Books / OG-meta resolution is a
 * follow-up that needs server-side rate-limited fan-out.
 */
export default function AddBulk() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [paste, setPaste] = useState("");

  const parsed = useMemo(() => parsePasteLines(paste), [paste]);
  const canSubmit = parsed.length > 0;
  const tooMany = parsed.length > BULK_LIMIT;

  const mutation = useMutation<{ created: number }, Error, void>({
    mutationFn: async () => {
      if (!id) throw new Error("Missing list id");
      // Server caps at 50; chunk if the paste is larger.
      let total = 0;
      for (let i = 0; i < parsed.length; i += BULK_LIMIT) {
        const slice = parsed.slice(i, i + BULK_LIMIT);
        const res = await createItemsBulk(id, { items: slice.map((title) => ({ title })) }, token);
        total += res.created;
      }
      return { created: total };
    },
    onSuccess: ({ created }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id ?? "") });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({
        message: created === 1 ? "Added 1 item." : `Added ${created} items.`,
        tone: "success",
      });
      goBack(id ? `/list/${id}` : "/");
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add those."), tone: "danger" });
    },
  });

  const countLabel =
    parsed.length === 0
      ? "Paste one per line."
      : parsed.length === 1
        ? "1 item to add"
        : `${parsed.length} items to add`;

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Cancel" onPress={() => goBack(id ? `/list/${id}` : "/")}>
          <Text style={styles.headerGlyph}>✕</Text>
        </IconButton>
        <Text variant="heading">Paste many</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <Text tone="secondary" style={styles.intro}>
          One per line. Numbered or bulleted lists are fine; leading{" "}
          <Text style={styles.code}>1.</Text>, <Text style={styles.code}>-</Text>, or{" "}
          <Text style={styles.code}>*</Text> markers are stripped automatically.
        </Text>

        <TextInput
          testID="add-bulk-input"
          value={paste}
          onChangeText={setPaste}
          placeholder={`Hereditary\nPast Lives\nThe Bear S2`}
          placeholderTextColor={tokens.text.muted}
          multiline
          autoFocus
          textAlignVertical="top"
          style={styles.input}
          accessibilityLabel="Paste items, one per line"
        />

        <View style={styles.countRow}>
          <Text tone={tooMany ? "danger" : "muted"} style={styles.count} testID="add-bulk-count">
            {tooMany
              ? `${parsed.length} items. We add the first ${BULK_LIMIT} now and the rest in batches.`
              : countLabel}
          </Text>
        </View>

        {parsed.length > 0 ? (
          <View style={styles.previewBlock}>
            <Text variant="caption" tone="muted" style={styles.previewLabel}>
              Preview
            </Text>
            <View style={styles.previewList}>
              {parsed.slice(0, 8).map((title) => (
                <View key={title} style={styles.previewRow}>
                  <Text tone="primary" numberOfLines={1} style={styles.previewTitle}>
                    {title}
                  </Text>
                </View>
              ))}
              {parsed.length > 8 ? (
                <Text tone="muted" style={styles.previewMore}>
                  + {parsed.length - 8} more
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.footer}>
          <Button
            testID="add-bulk-submit"
            label={
              parsed.length === 0 ? "Add" : parsed.length === 1 ? "Add 1" : `Add ${parsed.length}`
            }
            size="lg"
            disabled={!canSubmit || mutation.isPending}
            loading={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  intro: { fontSize: tokens.font.size.sm, lineHeight: 20 },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    color: tokens.text.secondary,
  },
  input: {
    minHeight: 220,
    maxHeight: 360,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    lineHeight: 22,
  },
  countRow: { flexDirection: "row", justifyContent: "flex-end" },
  count: { fontSize: tokens.font.size.xs, letterSpacing: 0.2 },
  previewBlock: { gap: tokens.space.sm },
  previewLabel: { textTransform: "uppercase", letterSpacing: 0.6 },
  previewList: {
    gap: 4,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  previewRow: { paddingVertical: 4 },
  previewTitle: { fontSize: tokens.font.size.sm },
  previewMore: { paddingTop: 4, fontSize: tokens.font.size.xs },
  footer: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xl,
    paddingTop: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
  },
});
