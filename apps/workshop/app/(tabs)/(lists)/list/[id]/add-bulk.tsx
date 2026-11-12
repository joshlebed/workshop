import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import {
  Button,
  Screen,
  ScreenHeader,
  SectionHeader,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createItemsBulk, fetchItems } from "../../../../../src/api/items";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { splitAgainstList } from "../../../../../src/lib/duplicates";
import { goBack } from "../../../../../src/lib/goBack";
import { parsePasteLines } from "../../../../../src/lib/parsePasteLines";
import { noteItemAdded } from "../../../../../src/lib/recentlyAdded";

// Server-side BULK_LIMIT in lists.ts. Mirrored here so the client can chunk
// silently rather than 400 the request. If you bump one, bump both.
const BULK_LIMIT = 50;

/**
 * Bulk-paste flow: one item per line. Strips blanks and leading bullet/number
 * markers, de-duplicates within the paste and against the list
 * (case-insensitive, "3 already on the list, skipped"), and POSTs in chunks
 * of 50. Lines go in bottom-up so the list shows them in the pasted order
 * (new items land on top). If a chunk fails, the lines that did go in are
 * removed from the box so a retry never adds them twice.
 */
export default function AddBulk() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [paste, setPaste] = useState("");

  const itemsQuery = useQuery({
    queryKey: queryKeys.items.byList(id),
    queryFn: () => fetchItems(id, token),
    enabled: !!token && !!id,
  });
  const existing = useMemo(
    () =>
      itemsQuery.data
        ? [...itemsQuery.data.ordered, ...itemsQuery.data.unordered, ...itemsQuery.data.completed]
        : [],
    [itemsQuery.data],
  );

  const parsed = useMemo(() => parsePasteLines(paste), [paste]);
  const { fresh, skipped } = useMemo(() => splitAgainstList(parsed, existing), [parsed, existing]);
  const canSubmit = fresh.length > 0;
  const overLimit = fresh.length > BULK_LIMIT;

  const mutation = useMutation<{ created: number }, Error, void>({
    mutationFn: async () => {
      // Bottom-up, so the first pasted line ends up on top of the list.
      const queue = fresh.slice().reverse();
      const done = new Set<string>();
      let total = 0;
      try {
        for (let i = 0; i < queue.length; i += BULK_LIMIT) {
          const slice = queue.slice(i, i + BULK_LIMIT);
          const res = await createItemsBulk(
            id,
            { items: slice.map((title) => ({ title })) },
            token,
          );
          total += res.created;
          for (const item of res.items) {
            done.add(item.title);
            noteItemAdded(id, item.id);
          }
        }
      } catch (e) {
        if (done.size > 0) {
          // Keep only what still needs adding.
          setPaste(parsed.filter((line) => !done.has(line)).join("\n"));
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) });
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
        }
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { added: done.size });
      }
      return { created: total };
    },
    onSuccess: ({ created }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({
        message: `Added ${created} ${created === 1 ? "item" : "items"}`,
        tone: "success",
      });
      goBack(`/list/${id}`);
    },
    onError: (e) => {
      const added = (e as { added?: number }).added ?? 0;
      showToast({
        message:
          added > 0
            ? `Added ${added}, then something went wrong. The rest are still here.`
            : errorMessage(e, "Couldn't add those."),
        tone: "danger",
      });
    },
  });

  const skippedNote = skipped.length > 0 ? `${skipped.length} already on the list, skipped` : null;
  const countLabel =
    fresh.length === 0
      ? skipped.length > 0
        ? "Everything here is already on the list."
        : "Paste one per line."
      : `${fresh.length} ${fresh.length === 1 ? "item" : "items"} to add`;
  const statusLine = [countLabel, skippedNote].filter(Boolean).join(" · ");

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="close"
        leadingLabel="Cancel"
        leadingTestID="add-bulk-cancel"
        onLeadingPress={() => goBack(`/list/${id}`)}
        title="Paste many"
      />

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

        <TextField
          testID="add-bulk-input"
          value={paste}
          onChangeText={setPaste}
          placeholder={`Hereditary\nPast Lives\nThe Bear S2`}
          multiline
          autoFocus
          textAlignVertical="top"
          inputStyle={styles.input}
          accessibilityLabel="Paste items, one per line"
        />

        <View style={styles.countRow}>
          <Text tone="muted" style={styles.count} testID="add-bulk-count">
            {statusLine}
          </Text>
        </View>
        {overLimit ? (
          <Text tone="muted" style={styles.count} testID="add-bulk-batches">
            Added in batches of {BULK_LIMIT}.
          </Text>
        ) : null}

        {fresh.length > 0 ? (
          <View style={styles.previewBlock}>
            <SectionHeader title="Preview" />
            <View style={styles.previewList}>
              {fresh.slice(0, 8).map((title) => (
                <View key={title} style={styles.previewRow}>
                  <Text tone="primary" numberOfLines={1} style={styles.previewTitle}>
                    {title}
                  </Text>
                </View>
              ))}
              {fresh.length > 8 ? (
                <Text tone="muted" style={styles.previewMore}>
                  + {fresh.length - 8} more
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
            label={fresh.length === 0 ? "Add" : `Add ${fresh.length}`}
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
  },
  scroll: { flex: 1 },
  body: {
    paddingTop: tokens.space.md,
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  intro: { fontSize: tokens.font.size.sm, lineHeight: 20 },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: tokens.font.size.sm,
    color: tokens.text.secondary,
  },
  input: {
    minHeight: 220,
    maxHeight: 360,
    paddingVertical: tokens.space.md,
  },
  countRow: { flexDirection: "row" },
  count: { fontSize: tokens.font.size.xs, letterSpacing: 0.2 },
  previewBlock: { gap: tokens.space.sm },
  previewList: {
    gap: tokens.space.xs,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  previewRow: { paddingVertical: tokens.space.xs },
  previewTitle: { fontSize: tokens.font.size.sm },
  previewMore: { paddingTop: tokens.space.xs, fontSize: tokens.font.size.xs },
  footer: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xl,
    paddingTop: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
  },
});
