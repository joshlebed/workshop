import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ItemListResponse, ListType } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { createItem } from "../../../src/api/items";
import { useAuth } from "../../../src/hooks/useAuth";
import { ApiError } from "../../../src/lib/api";
import { haptics } from "../../../src/lib/haptics";
import { queryKeys } from "../../../src/lib/queryKeys";
import { Button, Card, IconButton, Text, tokens, useToast } from "../../../src/ui/index";

const STUB_TYPES: readonly ListType[] = ["movie", "tv", "book"];

export default function AddItem() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const type = (Array.isArray(params.type) ? params.type[0] : params.type) as ListType | undefined;
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length >= 1 && trimmedTitle.length <= 500;

  const showsStubBanner = type ? STUB_TYPES.includes(type) : false;

  const addMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      const trimmedUrl = url.trim();
      const trimmedNote = note.trim();
      return createItem(
        id,
        {
          title: trimmedTitle,
          ...(trimmedUrl.length > 0 ? { url: trimmedUrl } : {}),
          ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
        },
        token,
      );
    },
    onSuccess: async (res) => {
      haptics.medium();
      if (id) {
        const activeKey = queryKeys.items.byListFiltered(id, false);
        const previous = queryClient.getQueryData<ItemListResponse>(activeKey);
        if (previous) {
          queryClient.setQueryData<ItemListResponse>(activeKey, {
            items: [res.item, ...previous.items],
          });
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byListFiltered(id, false) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        ]);
      }
      router.back();
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't add item",
        tone: "danger",
      });
    },
  });

  if (!id) {
    return (
      <View style={styles.root}>
        <Text>Missing list id.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Cancel" onPress={() => router.back()}>
          <Text style={styles.headerGlyph}>✕</Text>
        </IconButton>
        <Text variant="heading">Add item</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {showsStubBanner ? (
          <Card style={styles.banner}>
            <Text tone="secondary" variant="caption">
              Search-driven adding for movies, TV, and books lands in Phase 2. For now, type the
              title manually.
            </Text>
          </Card>
        ) : null}

        <Card style={styles.card} elevated>
          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Title
            </Text>
            <TextInput
              testID="add-item-title"
              value={title}
              onChangeText={setTitle}
              placeholder="What is it?"
              placeholderTextColor={tokens.text.muted}
              autoFocus
              maxLength={500}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              URL (optional)
            </Text>
            <TextInput
              testID="add-item-url"
              value={url}
              onChangeText={setUrl}
              placeholder="https://"
              placeholderTextColor={tokens.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={2048}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Note (optional)
            </Text>
            <TextInput
              testID="add-item-note"
              value={note}
              onChangeText={setNote}
              placeholder="Anything to remember?"
              placeholderTextColor={tokens.text.muted}
              multiline
              maxLength={1000}
              style={[styles.input, styles.inputMultiline]}
            />
          </View>

          <Button
            testID="add-item-submit"
            label="Add"
            size="lg"
            disabled={!canSubmit || addMutation.isPending}
            loading={addMutation.isPending}
            onPress={() => addMutation.mutate()}
          />
        </Card>
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
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  banner: { backgroundColor: tokens.bg.elevated },
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
});
