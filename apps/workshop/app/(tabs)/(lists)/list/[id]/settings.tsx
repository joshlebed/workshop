import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  ConfigWarning,
  List,
  ListColor,
  ListDetailResponse,
  ListListResponse,
  ListMemberSummary,
  ListSource,
  ModuleName,
  UpdateListRequest,
} from "@workshop/shared";
import { MODULE_REMOVAL_WARNINGS } from "@workshop/shared/modules";
import {
  ActionSheet,
  Avatar,
  Button,
  confirm,
  EmojiBadge,
  formatRelative,
  Icon,
  IconButton,
  type ListColorKey,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Switch,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  archiveListEntirely,
  duplicateList,
  fetchListDetail,
  previewListConfig,
  updateList,
} from "../../../../../src/api/lists";
import { removeMember } from "../../../../../src/api/members";
import { transferOwnership } from "../../../../../src/api/share";
import { syncSource } from "../../../../../src/api/sources";
import { ShareListSheet } from "../../../../../src/components/ShareListSheet";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { pickCoverPhoto } from "../../../../../src/lib/coverPhoto";
import { firstEmoji } from "../../../../../src/lib/emoji";
import { goBack, openListOverHome } from "../../../../../src/lib/goBack";
import { reconcileTextDraft } from "../../../../../src/lib/itemDraft";
import { sourceErrorMessage } from "../../../../../src/lib/sourceErrors";

const COLOR_KEYS: readonly ListColorKey[] = [
  "sunset",
  "ocean",
  "forest",
  "grape",
  "rose",
  "sand",
  "slate",
];

const EMOJI_CHOICES = ["🎬", "📺", "📚", "💜", "✈️", "🍿", "🎮", "🎵", "🍔", "🌅", "🏔️", "🎨"];

const AUTOSAVE_DEBOUNCE_MS = 700;

/** Features (was "Modules"), in plain words. Leaderboard is retired and never shown. */
const FEATURES: ReadonlyArray<{ mod: ModuleName; label: string; description: string }> = [
  { mod: "todo", label: "Check off items", description: "Tick things off once they're done." },
  { mod: "ranking", label: "Ranking", description: "Keep a ranked section at the top." },
  {
    mod: "sources",
    label: "Syncing",
    description: "Pull in new items from a linked playlist or list.",
  },
  {
    mod: "letterboxd",
    label: "Letterboxd matching",
    description: "Suggest films that are on members' watchlists.",
  },
];

/** What turning a feature off costs, asked before it happens. */
function featureWarningCopy(w: ConfigWarning): { title: string; message: string; confirm: string } {
  const n = w.affectedCount ?? 0;
  const items = (one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  switch (w.code) {
    case MODULE_REMOVAL_WARNINGS.todo:
      return {
        title: `Hide ${items("finished item", "finished items")}?`,
        message: "They come back if you turn this on again.",
        confirm: "Turn off",
      };
    case MODULE_REMOVAL_WARNINGS.ranking:
      return {
        title: `Drop the ranking of ${items("item", "items")}?`,
        message: "The order is kept, and comes back if you turn ranking on again.",
        confirm: "Turn off",
      };
    case MODULE_REMOVAL_WARNINGS.sources:
      return {
        title: `Stop syncing ${items("source", "sources")}?`,
        message: "Items already pulled in stay on the list.",
        confirm: "Stop syncing",
      };
    case MODULE_REMOVAL_WARNINGS.letterboxd:
      return {
        title: `Keep ${items("suggestion", "suggestions")} as regular items?`,
        message: "Matching stops. Turn it on again to bring suggestions back.",
        confirm: "Turn off",
      };
    default:
      return { title: "Change features?", message: w.message, confirm: "Change" };
  }
}

type SaveStatus = "idle" | "saving" | "saved";

export default function ListSettings() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  const router = useRouter();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id),
    queryFn: () => fetchListDetail(id, token),
    enabled: !!token && !!id,
  });

  const list = listQuery.data?.list;
  const members = listQuery.data?.members ?? [];
  const sources: ListSource[] = listQuery.data?.sources ?? [];
  const isOwner = !!list && !!user && list.ownerId === user.id;
  const [shareOpen, setShareOpen] = useState(false);

  // --- Saving ---------------------------------------------------------------
  // One "Saving… / Saved" for the screen, like item detail.
  const [status, setStatus] = useState<SaveStatus>("idle");
  const pendingRef = useRef(0);
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  const patchCaches = useCallback(
    (patch: Partial<List>) => {
      queryClient.setQueryData<ListDetailResponse>(queryKeys.lists.detail(id), (d) =>
        d ? { ...d, list: { ...d.list, ...patch } } : d,
      );
      queryClient.setQueryData<ListListResponse>(queryKeys.lists.all, (d) =>
        d ? { lists: d.lists.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d,
      );
    },
    [queryClient, id],
  );

  // Every edit is a PATCH of the fields it touches: optimistic on both list
  // caches, rolled back with a toast if the server says no.
  const saveMutation = useMutation<
    unknown,
    Error,
    { patch: UpdateListRequest; label: string },
    { detail?: ListDetailResponse; lists?: ListListResponse }
  >({
    mutationFn: ({ patch }) => updateList(id, patch, token),
    onMutate: async ({ patch }) => {
      pendingRef.current += 1;
      setStatus("saving");
      await queryClient.cancelQueries({ queryKey: queryKeys.lists.detail(id) });
      const detail = queryClient.getQueryData<ListDetailResponse>(queryKeys.lists.detail(id));
      const lists = queryClient.getQueryData<ListListResponse>(queryKeys.lists.all);
      patchCaches(patch as Partial<List>);
      return { detail, lists };
    },
    onError: (e, { label }, ctx) => {
      if (ctx?.detail) queryClient.setQueryData(queryKeys.lists.detail(id), ctx.detail);
      if (ctx?.lists) queryClient.setQueryData(queryKeys.lists.all, ctx.lists);
      showToast({ message: errorMessage(e, `Couldn't save the ${label}.`), tone: "danger" });
    },
    onSettled: (_r, error) => {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (pendingRef.current === 0) setStatus(error ? "idle" : "saved");
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });
  const save = saveMutation.mutate;

  // --- Text drafts (name, description) --------------------------------------
  // Seeded once per list; afterwards a refetch only reaches a field that is not
  // focused and holds no unsaved edit (the item-detail rule, 0.2).
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const seededRef = useRef<string | null>(null);
  const serverRef = useRef<{ name: string; description: string } | null>(null);
  const focusedRef = useRef<"name" | "description" | null>(null);
  useEffect(() => {
    if (!list) return;
    const next = { name: list.name, description: list.description ?? "" };
    const prev = serverRef.current;
    serverRef.current = next;
    if (seededRef.current !== list.id || !prev) {
      seededRef.current = list.id;
      setName(next.name);
      setDescription(next.description);
      return;
    }
    setName((draft) =>
      reconcileTextDraft({
        draft,
        prevServer: prev.name,
        nextServer: next.name,
        focused: focusedRef.current === "name",
      }),
    );
    setDescription((draft) =>
      reconcileTextDraft({
        draft,
        prevServer: prev.description,
        nextServer: next.description,
        focused: focusedRef.current === "description",
      }),
    );
  }, [list]);

  const draftRef = useRef({ name, description });
  draftRef.current = { name, description };
  const lastSentRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushText = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const server = serverRef.current;
    if (!server) return;
    const nextName = draftRef.current.name.trim();
    const nextDesc = draftRef.current.description.trim();
    const patch: UpdateListRequest = {};
    if (nextName.length > 0 && nextName.length <= 100 && nextName !== server.name) {
      patch.name = nextName;
    }
    if (nextDesc !== server.description.trim()) patch.description = nextDesc || null;
    if (Object.keys(patch).length === 0) return;
    const key = JSON.stringify(patch);
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    save(
      { patch, label: patch.name !== undefined ? "name" : "description" },
      {
        onSettled: () => {
          lastSentRef.current = null;
        },
      },
    );
  }, [save]);

  useEffect(() => {
    const server = serverRef.current;
    if (!server || !isOwner) return;
    const dirty =
      (name.trim() !== server.name && name.trim().length > 0) ||
      description.trim() !== server.description.trim();
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flushText, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [name, description, isOwner, flushText]);

  // Leaving never drops the last keystrokes still waiting on the debounce.
  useEffect(() => () => flushText(), [flushText]);

  const onBack = useCallback(() => {
    flushText();
    goBack(`/list/${id}`);
  }, [flushText, id]);

  // --- Emoji ----------------------------------------------------------------
  const [customEmoji, setCustomEmoji] = useState("");
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const applyCustomEmoji = () => {
    if (!customEmoji.trim()) {
      setEmojiError(null);
      return;
    }
    const picked = firstEmoji(customEmoji);
    if (!picked) {
      setEmojiError("That isn't an emoji. Type or paste one.");
      return;
    }
    setEmojiError(null);
    setCustomEmoji("");
    if (list && picked !== list.emoji) save({ patch: { emoji: picked }, label: "emoji" });
  };

  // --- Features ---------------------------------------------------------------
  // The switch flips at once; turning a feature off asks first when it hides
  // something (the server's config preview names what), and reverts if declined
  // or if the save fails.
  const [pendingModules, setPendingModules] = useState<ModuleName[] | null>(null);
  const modules = pendingModules ?? list?.modules ?? [];
  const toggleFeature = async (mod: ModuleName) => {
    if (!list || pendingModules) return;
    const next = modules.includes(mod) ? modules.filter((m) => m !== mod) : [...modules, mod];
    setPendingModules(next);
    try {
      const preview = await previewListConfig(id, { modules: next }, token);
      let acknowledgedWarnings: string[] | undefined;
      if (preview.warnings.length > 0) {
        const first = preview.warnings[0];
        const copy = first ? featureWarningCopy(first) : null;
        const ok = copy
          ? await confirm({
              title: copy.title,
              message: preview.warnings
                .map((w) => featureWarningCopy(w).message)
                .filter((m, i, all) => all.indexOf(m) === i)
                .join(" "),
              confirmLabel: copy.confirm,
              destructive: true,
            })
          : true;
        if (!ok) {
          setPendingModules(null);
          return;
        }
        acknowledgedWarnings = preview.warnings.map((w) => w.code);
      }
      setStatus("saving");
      await updateList(
        id,
        { modules: next, ...(acknowledgedWarnings ? { acknowledgedWarnings } : {}) },
        token,
      );
      patchCaches({ modules: next });
      setStatus("saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) }),
      ]);
    } catch (e) {
      setStatus("idle");
      showToast({ message: errorMessage(e, "Couldn't change that feature."), tone: "danger" });
    } finally {
      setPendingModules(null);
    }
  };

  // --- Other actions --------------------------------------------------------
  const duplicateMutation = useMutation({
    mutationFn: () => duplicateList(id, {}, token),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      openListOverHome(res.list.id);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't duplicate the list."), tone: "danger" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (sourceId: string) => syncSource(id, sourceId, token),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) }),
      ]);
      showToast({
        message:
          res.addedCount === 0
            ? "Nothing new"
            : `${res.addedCount} new ${res.addedCount === 1 ? "item" : "items"}`,
        tone: res.addedCount === 0 ? "default" : "success",
      });
    },
    onError: (e, sourceId) => {
      showToast({
        message: sourceErrorMessage(e, "Couldn't sync."),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => syncMutation.mutate(sourceId),
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: (newOwnerId: string) => transferOwnership(id, newOwnerId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({ message: "Ownership handed over", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't hand over the list."), tone: "danger" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeMember(id, userId, token),
    onSuccess: async (_res, removedUserId) => {
      const isSelfLeave = !!user && removedUserId === user.id;
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      if (isSelfLeave) {
        router.dismissTo("/");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      showToast({ message: "Member removed" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that member."), tone: "danger" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => archiveListEntirely(id, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.dismissTo("/");
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't delete the list."), tone: "danger" });
    },
  });

  // 0.1: irreversible actions confirm first and name the list or the person.
  const listLabel = list ? `“${list.name}”` : "this list";
  const onDeleteList = async () => {
    const ok = await confirm({
      title: `Delete ${listLabel}?`,
      message: "Everyone on it loses access.",
      confirmLabel: "Delete list",
      destructive: true,
    });
    if (ok) deleteMutation.mutate();
  };
  const onLeaveList = async () => {
    if (!user) return;
    const ok = await confirm({
      title: `Leave ${listLabel}?`,
      message: "You lose access until someone shares the link with you again.",
      confirmLabel: "Leave list",
      destructive: true,
    });
    if (ok) removeMemberMutation.mutate(user.id);
  };
  const onRemoveMember = async (member: ListMemberSummary) => {
    const who = member.displayName ?? "this member";
    const ok = await confirm({
      title: `Remove ${who} from ${listLabel}?`,
      message: "They lose access to the list. Items they added stay.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMemberMutation.mutate(member.userId);
  };
  const onMakeOwner = async (member: ListMemberSummary) => {
    const who = member.displayName ?? "this member";
    const ok = await confirm({
      title: `Make ${who} the owner of ${listLabel}?`,
      message: "You become a member and can no longer change its settings or delete it.",
      confirmLabel: "Make owner",
      destructive: true,
    });
    if (ok) transferMutation.mutate(member.userId);
  };

  const [memberMenuFor, setMemberMenuFor] = useState<ListMemberSummary | null>(null);
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);

  // Esc goes back on web (not while typing in a field).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onBack]);

  if (!id) {
    return (
      <Screen style={styles.center}>
        <Text>Missing list id</Text>
      </Screen>
    );
  }

  const accent = list
    ? (tokens.list[list.color as ListColorKey] ?? tokens.accent.default)
    : tokens.accent.default;
  const emojiChoices =
    list && !EMOJI_CHOICES.includes(list.emoji) ? [list.emoji, ...EMOJI_CHOICES] : EMOJI_CHOICES;
  const shareSubtitle = !list
    ? ""
    : list.shareVisibility === "join"
      ? "Anyone with the link can join"
      : list.shareVisibility === "view"
        ? "Anyone with the link can view"
        : isOwner
          ? "Off. Only members can open it."
          : "Off. Only the owner can turn it on.";

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={onBack}
        leadingTestID="settings-back"
        eyebrow="List settings"
        title={list?.name ?? ""}
        titleAccessory={
          list ? (
            <EmojiBadge emoji={list.emoji} color={accent} imageUrl={list.coverPhotoUrl} />
          ) : null
        }
        trailing={
          status === "idle" ? null : (
            <Text variant="caption" tone="muted" style={styles.saved} testID="settings-save-status">
              {status === "saving" ? "Saving…" : "Saved"}
            </Text>
          )
        }
      />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        {!list && listQuery.isPending ? (
          <View style={styles.section} testID="settings-skeleton">
            <Skeleton.Block width={72} height={12} />
            <Skeleton.Rows count={3} badge={44} />
            <Skeleton.Block width={72} height={12} style={styles.skeletonGap} />
            <Skeleton.Block height={44} radius={tokens.radius.md} />
          </View>
        ) : list ? (
          <>
            {/* --- Members, with sharing first --- */}
            <View style={styles.section}>
              <SectionHeader
                title="Members"
                trailing={
                  <Text variant="caption" tone="muted">
                    {members.length}
                  </Text>
                }
                style={styles.sectionHeader}
              />
              <ListRow
                leading={
                  <View style={styles.shareMark}>
                    <Icon name="share" size={18} tone="accent" />
                  </View>
                }
                title="Share link"
                subtitle={shareSubtitle}
                chevron
                onPress={() => setShareOpen(true)}
                testID="settings-share"
              />
              {members.map((m) => {
                const isSelf = !!user && m.userId === user.id;
                const canManage = isOwner && !isSelf && m.role !== "owner";
                return (
                  <ListRow
                    key={m.userId}
                    testID={`settings-member-${m.userId}`}
                    leading={
                      <Avatar
                        name={m.displayName}
                        imageUrl={userAvatarImageUrl(m.userId)}
                        size="lg"
                        style={styles.memberAvatar}
                      />
                    }
                    title={`${m.displayName ?? "No name"}${isSelf ? " (you)" : ""}`}
                    subtitle={m.role === "owner" ? "Owner" : "Member"}
                    trailing={
                      canManage ? (
                        <IconButton
                          icon="more"
                          iconTone="secondary"
                          accessibilityLabel={`Manage ${m.displayName ?? "member"}`}
                          disabled={removeMemberMutation.isPending || transferMutation.isPending}
                          onPress={() => {
                            setMemberMenuFor(m);
                            setMemberMenuOpen(true);
                          }}
                          testID={`settings-member-menu-${m.userId}`}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </View>

            {/* --- Details (owner) --- */}
            {isOwner ? (
              <View style={styles.section}>
                <SectionHeader title="Details" style={styles.sectionHeader} />
                <View style={styles.fields}>
                  <TextField
                    label="Name"
                    testID="settings-name"
                    value={name}
                    onChangeText={setName}
                    onFocus={() => {
                      focusedRef.current = "name";
                    }}
                    onBlur={() => {
                      if (focusedRef.current === "name") focusedRef.current = null;
                      setName((v) => v.trim() || serverRef.current?.name || v);
                      flushText();
                    }}
                    error={name.trim().length === 0 ? "A list needs a name." : undefined}
                    maxLength={100}
                    returnKeyType="done"
                  />

                  <View style={styles.field}>
                    <Text variant="label" tone="secondary">
                      Emoji
                    </Text>
                    <View style={styles.emojiRow} role="radiogroup" aria-label="Emoji">
                      {emojiChoices.map((choice) => {
                        const selected = choice === list.emoji;
                        return (
                          <Pressable
                            key={choice}
                            role="radio"
                            aria-checked={selected}
                            accessibilityLabel={`Emoji ${choice}`}
                            onPress={() => {
                              if (!selected) save({ patch: { emoji: choice }, label: "emoji" });
                            }}
                            style={({ pressed }) => [
                              styles.emojiCell,
                              selected && styles.emojiCellSelected,
                              pressed && styles.cellPressed,
                            ]}
                            testID={`settings-emoji-${choice}`}
                          >
                            <Text style={styles.emojiGlyph}>{choice}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextField
                      accessibilityLabel="Type or paste any emoji"
                      placeholder="Or type or paste any emoji"
                      value={customEmoji}
                      onChangeText={(v) => {
                        setCustomEmoji(v);
                        if (emojiError) setEmojiError(null);
                      }}
                      onSubmitEditing={applyCustomEmoji}
                      onBlur={applyCustomEmoji}
                      error={emojiError ?? undefined}
                      autoCorrect={false}
                      returnKeyType="done"
                      testID="settings-emoji-custom"
                    />
                  </View>

                  <View style={styles.field}>
                    <Text variant="label" tone="secondary">
                      Color
                    </Text>
                    <View style={styles.colorRow} role="radiogroup" aria-label="Color">
                      {COLOR_KEYS.map((key) => {
                        const selected = key === list.color;
                        return (
                          <Pressable
                            key={key}
                            role="radio"
                            aria-checked={selected}
                            accessibilityLabel={`Color ${key}`}
                            onPress={() => {
                              if (!selected)
                                save({ patch: { color: key as ListColor }, label: "color" });
                            }}
                            style={styles.colorTarget}
                            testID={`settings-color-${key}`}
                          >
                            {({ pressed }) => (
                              <View
                                style={[
                                  styles.colorCell,
                                  { backgroundColor: tokens.list[key] },
                                  selected && styles.colorCellSelected,
                                  pressed && styles.cellPressed,
                                ]}
                              />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text variant="label" tone="secondary">
                      Cover photo
                    </Text>
                    <View style={styles.coverRow}>
                      {list.coverPhotoUrl ? (
                        <Image
                          source={{ uri: list.coverPhotoUrl }}
                          style={styles.coverPreview}
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <View style={[styles.coverPreview, styles.coverPreviewEmpty]}>
                          <Text style={styles.coverPreviewEmoji}>{list.emoji}</Text>
                        </View>
                      )}
                      <View style={styles.coverButtons}>
                        <Button
                          testID="settings-cover-pick"
                          label={list.coverPhotoUrl ? "Change photo" : "Add a photo"}
                          variant="secondary"
                          onPress={async () => {
                            const picked = await pickCoverPhoto();
                            if (picked)
                              save({ patch: { coverPhotoUrl: picked.dataUrl }, label: "photo" });
                          }}
                        />
                        {list.coverPhotoUrl ? (
                          <Button
                            testID="settings-cover-remove"
                            label="Remove"
                            variant="ghost"
                            onPress={() => save({ patch: { coverPhotoUrl: null }, label: "photo" })}
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <TextField
                    label="Description"
                    testID="settings-description"
                    value={description}
                    onChangeText={setDescription}
                    onFocus={() => {
                      focusedRef.current = "description";
                    }}
                    onBlur={() => {
                      if (focusedRef.current === "description") focusedRef.current = null;
                      setDescription((v) => v.trim());
                      flushText();
                    }}
                    multiline
                    maxLength={280}
                  />
                </View>
              </View>
            ) : null}

            {/* --- Features (owner) --- */}
            {isOwner ? (
              <View style={styles.section}>
                <SectionHeader title="Features" style={styles.sectionHeader} />
                <View style={styles.fields}>
                  {FEATURES.map((f) => (
                    <Switch
                      key={f.mod}
                      label={f.label}
                      description={f.description}
                      value={modules.includes(f.mod)}
                      disabled={!!pendingModules}
                      onValueChange={() => void toggleFeature(f.mod)}
                      testID={`settings-module-${f.mod}`}
                    />
                  ))}
                  {sources.map((src) => (
                    <SourceRow
                      key={src.id}
                      source={src}
                      busy={syncMutation.isPending && syncMutation.variables === src.id}
                      onSync={() => syncMutation.mutate(src.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {/* --- Duplicate --- */}
            <View style={styles.section}>
              <ListRow
                title="Duplicate list"
                subtitle="Copies the items. Checked-off state and syncing start fresh."
                onPress={() => duplicateMutation.mutate()}
                disabled={duplicateMutation.isPending}
                trailing={
                  duplicateMutation.isPending ? (
                    <Text variant="caption" tone="muted">
                      Copying…
                    </Text>
                  ) : undefined
                }
                testID="settings-duplicate-list"
              />
            </View>

            {/* --- The destructive action, last --- */}
            <View style={styles.section}>
              <SectionHeader
                title={isOwner ? "Delete list" : "Leave list"}
                style={styles.sectionHeader}
              />
              <View style={styles.fields}>
                <Text tone="secondary">
                  {isOwner
                    ? "Removes the list for everyone on it. This can't be undone from the app."
                    : "Items you added stay on the list."}
                </Text>
                <View style={styles.dangerRow}>
                  {isOwner ? (
                    <Button
                      testID="settings-delete-list"
                      label="Delete list"
                      variant="danger"
                      loading={deleteMutation.isPending}
                      disabled={deleteMutation.isPending}
                      onPress={() => void onDeleteList()}
                    />
                  ) : (
                    <Button
                      testID="settings-leave-list"
                      label="Leave list"
                      variant="danger"
                      loading={removeMemberMutation.isPending}
                      disabled={!user || removeMemberMutation.isPending}
                      onPress={() => void onLeaveList()}
                    />
                  )}
                </View>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <Text tone="secondary">
              {listQuery.isError ? errorMessage(listQuery.error, "Couldn't load this list.") : ""}
            </Text>
          </View>
        )}
      </KeyboardAwareScrollView>

      <ShareListSheet list={list ?? null} visible={shareOpen} onClose={() => setShareOpen(false)} />
      <ActionSheet
        visible={memberMenuOpen}
        onClose={() => setMemberMenuOpen(false)}
        title={memberMenuFor?.displayName ?? "Member"}
        items={
          memberMenuFor
            ? [
                {
                  label: "Make owner",
                  onPress: () => void onMakeOwner(memberMenuFor),
                  testID: "settings-make-owner",
                },
                {
                  label: "Remove from list",
                  tone: "danger",
                  onPress: () => void onRemoveMember(memberMenuFor),
                  testID: "settings-remove-member",
                },
              ]
            : []
        }
        testID="settings-member-menu"
      />
    </Screen>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  spotify_playlist: "Spotify playlist",
  letterboxd_list: "Letterboxd list",
  letterboxd_match: "Letterboxd watchlists",
};

function SourceRow({
  source,
  busy,
  onSync,
}: {
  source: ListSource;
  busy: boolean;
  onSync: () => void;
}) {
  return (
    <ListRow
      title={SOURCE_NAMES[source.kind] ?? "Linked source"}
      subtitle={
        source.lastSyncedAt ? `Synced ${formatRelative(source.lastSyncedAt)}` : "Not synced yet"
      }
      style={styles.sourceRow}
      trailing={
        <Button
          label="Sync now"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onPress={onSync}
          testID={`settings-source-${source.id}-sync`}
        />
      }
      testID={`settings-source-${source.id}`}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingBottom: tokens.space.xxl * 2 },
  saved: { paddingHorizontal: tokens.space.sm },
  section: { paddingTop: tokens.space.xl },
  sectionHeader: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.xs },
  fields: { gap: tokens.space.lg, paddingHorizontal: tokens.space.lg },
  field: { gap: tokens.space.sm },
  skeletonGap: { marginTop: tokens.space.md },
  shareMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
  },
  memberAvatar: { width: 44, height: 44, borderRadius: 22 },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiCellSelected: { borderColor: tokens.accent.default, backgroundColor: tokens.accent.muted },
  cellPressed: { opacity: 0.7 },
  // lineHeight pinned so the glyph isn't clipped to the body line box on iOS.
  emojiGlyph: { fontSize: tokens.font.size.lg, lineHeight: 24 },
  // Each swatch sits in a 44pt press target (web ignores hitSlop).
  colorRow: { flexDirection: "row", flexWrap: "wrap" },
  colorTarget: {
    width: tokens.hit,
    height: tokens.hit,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
  },
  colorCell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorCellSelected: { borderColor: tokens.text.primary },
  coverRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  coverButtons: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap", flex: 1 },
  coverPreview: { width: 64, height: 64, borderRadius: tokens.radius.md },
  coverPreviewEmpty: {
    backgroundColor: tokens.bg.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  coverPreviewEmoji: { fontSize: 28, lineHeight: 32 },
  sourceRow: { marginHorizontal: 0, paddingHorizontal: 0 },
  dangerRow: { flexDirection: "row" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
