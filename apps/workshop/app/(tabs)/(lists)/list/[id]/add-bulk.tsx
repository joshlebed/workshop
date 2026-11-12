import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { listKind } from "@workshop/shared/listKinds";
import {
  Button,
  haptics,
  layout,
  Screen,
  ScreenHeader,
  SectionHeader,
  screenColumnStyle,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { createItemsBulk, fetchItems } from "../../../../../src/api/items";
import { fetchListDetail } from "../../../../../src/api/lists";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { splitAgainstList } from "../../../../../src/lib/duplicates";
import { FAILURE_TOAST_KEY, failureMessage } from "../../../../../src/lib/errorCopy";
import { goBack } from "../../../../../src/lib/goBack";
import { parsePasteLines } from "../../../../../src/lib/parsePasteLines";
import { noteItemAdded } from "../../../../../src/lib/recentlyAdded";
import { useEscapeToClose, useSubmitShortcut } from "../../../../../src/lib/shortcuts/useShortcuts";

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
  // Usually warm from the list screen. A kind without Paste many (the album
  // shelf fills from its playlist) says so instead of offering the form.
  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id),
    queryFn: () => fetchListDetail(id, token),
    enabled: !!token && !!id,
  });
  const kind = listQuery.data ? listKind(listQuery.data.list.itemKind) : null;
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
    // A bulk add is a create: `success`, on the tap.
    onMutate: () => haptics.success(),
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
        key: FAILURE_TOAST_KEY,
        message:
          added > 0
            ? `Added ${added}, then something went wrong. The rest are still here.`
            : failureMessage(e, "Couldn't add those."),
        tone: "danger",
      });
    },
  });

  const skippedNote = skipped.length > 0 ? `${skipped.length} already on the list, skipped` : null;
  const countLabel =
    fresh.length === 0
      ? skipped.length > 0
        ? "Everything here is already on the list."
        : "Nothing to add yet."
      : `${fresh.length} ${fresh.length === 1 ? "item" : "items"} to add`;
  const statusLine = [countLabel, skippedNote].filter(Boolean).join(" · ");

  // Web: Escape closes, ⌘Enter adds everything (5.7b).
  const isFocused = useIsFocused();
  useEscapeToClose(() => goBack(`/list/${id}`), isFocused);
  useSubmitShortcut(() => {
    if (canSubmit && !mutation.isPending) mutation.mutate();
  }, isFocused);

  if (kind && !kind.add.bulk) {
    return (
      <Screen style={styles.root}>
        <ScreenHeader
          leading="close"
          leadingLabel="Close"
          leadingTestID="add-bulk-cancel"
          onLeadingPress={() => goBack(`/list/${id}`)}
          title="Paste many"
        />
        <View style={[styles.body, screenColumnStyle]} testID="add-bulk-unavailable">
          <Text tone="secondary">
            {`${kind.empty.description} New ${kind.noun.many} arrive when it syncs.`}
          </Text>
        </View>
      </Screen>
    );
  }

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
        contentContainerStyle={[styles.body, screenColumnStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <Text variant="label" tone="secondary" style={styles.regular}>
          One item per line. Numbers and bullets at the start of a line (
          <Text variant="label" style={styles.code}>
            1.
          </Text>
          ,{" "}
          <Text variant="label" style={styles.code}>
            -
          </Text>
          ,{" "}
          <Text variant="label" style={styles.code}>
            *
          </Text>
          ) are left out.
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
          <Text variant="caption" tone="muted" testID="add-bulk-count">
            {statusLine}
          </Text>
        </View>
        {overLimit ? (
          <Text variant="caption" tone="muted" testID="add-bulk-batches">
            Added in batches of {BULK_LIMIT}.
          </Text>
        ) : null}

        {fresh.length > 0 ? (
          <View>
            {/* `first`: the body's 16 gap plus the header's 8 make the 24 above. */}
            <SectionHeader title="Preview" inset={false} first />
            <View style={styles.previewList}>
              {fresh.slice(0, 8).map((title) => (
                <View key={title} style={styles.previewRow}>
                  <Text variant="label" numberOfLines={1} style={styles.regular}>
                    {title}
                  </Text>
                </View>
              ))}
              {fresh.length > 8 ? (
                <Text variant="caption" tone="muted" style={styles.previewMore}>
                  + {fresh.length - 8} more
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={[styles.footer, screenColumnStyle]}>
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
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  regular: { fontWeight: tokens.font.weight.regular },
  // Inherits the size of the sentence it sits in.
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: tokens.text.secondary,
  },
  input: {
    minHeight: 220,
    maxHeight: 360,
    paddingVertical: tokens.space.md,
  },
  countRow: { flexDirection: "row" },
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
  previewMore: { paddingTop: tokens.space.xs },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.xl,
    paddingTop: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
  },
});
