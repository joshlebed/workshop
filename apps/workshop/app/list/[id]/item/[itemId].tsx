import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  archiveItem,
  completeItem,
  fetchItem,
  uncompleteItem,
  updateItem,
} from "../../../../src/api/items";
import { useAuth } from "../../../../src/hooks/useAuth";
import { ApiError } from "../../../../src/lib/api";
import { goBack } from "../../../../src/lib/goBack";
import { haptics } from "../../../../src/lib/haptics";
import { normalizeExternalUrl, openExternalUrl } from "../../../../src/lib/openUrl";
import { queryKeys } from "../../../../src/lib/queryKeys";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Screen,
  Text,
  tokens,
  useToast,
} from "../../../../src/ui/index";

export default function ItemDetail() {
  const params = useLocalSearchParams<{ id: string; itemId: string }>();
  const listId = Array.isArray(params.id) ? params.id[0] : params.id;
  const itemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const itemQuery = useQuery({
    queryKey: queryKeys.items.detail(itemId ?? ""),
    queryFn: () => fetchItem(itemId ?? "", token),
    enabled: !!token && !!itemId,
  });

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (itemQuery.data?.item) {
      setTitle(itemQuery.data.item.title);
      setNote(itemQuery.data.item.note ?? "");
      setUrl(itemQuery.data.item.url ?? "");
    }
  }, [itemQuery.data?.item]);

  function invalidateItem() {
    if (!itemId || !listId) return Promise.resolve();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) }),
    ]);
  }

  const completeMutation = useMutation({
    mutationFn: (nextCompleted: boolean) =>
      nextCompleted ? completeItem(itemId ?? "", token) : uncompleteItem(itemId ?? "", token),
    onSuccess: async () => {
      haptics.medium();
      await invalidateItem();
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't update item",
        tone: "danger",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmedTitle = title.trim();
      const trimmedNote = note.trim();
      // Force a scheme on bare hostnames so the saved URL is openable
      // straight from the row (no relative-path footgun on web).
      const normalizedUrl = normalizeExternalUrl(url);
      return updateItem(
        itemId ?? "",
        {
          title: trimmedTitle,
          note: trimmedNote.length === 0 ? null : trimmedNote,
          url: normalizedUrl,
        },
        token,
      );
    },
    onSuccess: async () => {
      await invalidateItem();
      showToast({ message: "Saved", tone: "success" });
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't save",
        tone: "danger",
      }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveItem(itemId ?? "", token),
    onSuccess: async () => {
      haptics.medium();
      if (listId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        ]);
      }
      goBack(`/list/${listId}`);
    },
    onError: (e) =>
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't archive",
        tone: "danger",
      }),
  });

  if (!itemId || !listId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing item id" />
      </Screen>
    );
  }

  if (itemQuery.isPending) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </Screen>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <Screen style={styles.center}>
        <EmptyState
          title="Couldn't load item"
          description={itemQuery.error instanceof Error ? itemQuery.error.message : undefined}
          action={<Button label="Retry" variant="secondary" onPress={() => itemQuery.refetch()} />}
        />
      </Screen>
    );
  }

  const item = itemQuery.data.item;
  // Leaderboard-enabled items have their own combined edit + leaderboard
  // screen at `/list/:id/game/:itemId`. If we know the parent list has the
  // leaderboard module on, redirect there so users land on the leaderboard
  // surface instead of the generic edit form.
  // (No-op for non-leaderboard lists.)
  const trimmedTitle = title.trim();
  const dirty =
    trimmedTitle !== item.title ||
    note.trim() !== (item.note ?? "") ||
    url.trim() !== (item.url ?? "");
  const canSave = trimmedTitle.length >= 1 && trimmedTitle.length <= 500 && dirty;

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => goBack(`/list/${listId}`)}>
          <Text style={styles.headerGlyph}>‹</Text>
        </IconButton>
        <Text variant="heading">Item</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <Card style={styles.card} elevated>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.completed ? "Mark as not done" : "Mark as done"}
              onPress={() => completeMutation.mutate(!item.completed)}
              testID="item-detail-complete"
              style={({ pressed }) => [
                styles.completeBtn,
                item.completed && styles.completeBtnDone,
                pressed && styles.completeBtnPressed,
              ]}
            >
              <Text style={styles.completeGlyph} tone={item.completed ? "onAccent" : "secondary"}>
                ✓
              </Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Title
            </Text>
            <TextInput
              testID="item-title-input"
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={tokens.text.muted}
              maxLength={500}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              URL
            </Text>
            <TextInput
              testID="item-url-input"
              value={url}
              onChangeText={setUrl}
              placeholder="https://"
              placeholderTextColor={tokens.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={2048}
              style={styles.input}
            />
            {item.url ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.url}`}
                onPress={() => openExternalUrl(item.url)}
              >
                <Text tone="secondary" numberOfLines={1} style={styles.urlPreview}>
                  Open ↗
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Note
            </Text>
            <TextInput
              testID="item-note-input"
              value={note}
              onChangeText={setNote}
              placeholder="Add a note"
              placeholderTextColor={tokens.text.muted}
              multiline
              maxLength={1000}
              style={[styles.input, styles.inputMultiline]}
            />
          </View>

          <Button
            testID="item-save"
            label="Save changes"
            disabled={!canSave || saveMutation.isPending}
            loading={saveMutation.isPending}
            onPress={() => saveMutation.mutate()}
          />
        </Card>

        <Button
          testID="item-delete"
          label="Delete item"
          variant="danger"
          disabled={archiveMutation.isPending}
          loading={archiveMutation.isPending}
          onPress={() => archiveMutation.mutate()}
        />
      </KeyboardAwareScrollView>
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
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
  },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  card: { gap: tokens.space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: tokens.space.md,
  },
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
  inputMultiline: { minHeight: 100, textAlignVertical: "top" },
  urlPreview: { textDecorationLine: "underline" },
  completeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: tokens.border.default,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
  },
  completeBtnDone: { backgroundColor: tokens.status.success, borderColor: tokens.status.success },
  completeBtnPressed: { opacity: 0.7 },
  completeGlyph: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.bold },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
});
