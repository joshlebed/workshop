import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  featureCopy,
  type ListKindProfile,
  listKind,
  type ToggleFeature,
} from "@workshop/shared/listKinds";
import { MODULE_REMOVAL_WARNINGS } from "@workshop/shared/modules";
import {
  ActionSheet,
  Avatar,
  Button,
  confirm,
  EmojiBadge,
  haptics,
  Icon,
  IconButton,
  type ListColorKey,
  ListRow,
  layout,
  Reveal,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Switch,
  screenColumnStyle,
  Text,
  TextField,
  tokens,
  useRevealAfterLoading,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
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
import { ColorChoices, EmojiChoices } from "../../../../../src/components/ListLookChoices";
import { ShareListSheet } from "../../../../../src/components/ShareListSheet";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { pickCoverPhoto } from "../../../../../src/lib/coverPhoto";
import { firstEmoji } from "../../../../../src/lib/emoji";
import {
  FAILURE_TOAST_KEY,
  failureMessage,
  loadErrorMessage,
} from "../../../../../src/lib/errorCopy";
import { goBack, openListOverHome } from "../../../../../src/lib/goBack";
import { reconcileTextDraft } from "../../../../../src/lib/itemDraft";
import { SyncedFrom } from "../../../../../src/screens/listSettings/SyncedFrom";

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

/** What turning a feature off costs, asked before it happens, in the list's own words. */
function featureWarningCopy(
  w: ConfigWarning,
  kind: ListKindProfile,
): { title: string; message: string; confirm: string } {
  const n = w.affectedCount ?? 0;
  const things = n === 1 ? kind.noun.one : kind.noun.many;
  switch (w.code) {
    case MODULE_REMOVAL_WARNINGS.todo:
      return {
        title: `Hide ${n} ${kind.done.toLowerCase()} ${things}?`,
        message: "They come back if you turn this on again.",
        confirm: "Turn off",
      };
    case MODULE_REMOVAL_WARNINGS.letterboxd:
      return {
        title: `Keep ${n} ${n === 1 ? "suggestion" : "suggestions"} as regular films?`,
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
  // Settings that replace the skeleton fade in; cached settings paint at once.
  const settingsRevealed = useRevealAfterLoading(!list && listQuery.isPending);
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
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, `Couldn't save the ${label}.`),
        tone: "danger",
      });
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
    if (list && picked !== list.emoji) {
      haptics.selection();
      save({ patch: { emoji: picked }, label: "emoji" });
    }
  };

  // --- Features ---------------------------------------------------------------
  // Only the toggles this kind of list offers (`@workshop/shared/listKinds`).
  // The switch flips at once; turning a feature off asks first when it hides
  // something (the server's config preview names what), and reverts if
  // declined or if the save fails. `sources` is not a switch: it follows what
  // "Synced from" has attached.
  const kind = listKind(list?.itemKind ?? null);
  const [pendingModules, setPendingModules] = useState<ModuleName[] | null>(null);
  const modules = pendingModules ?? list?.modules ?? [];
  const toggleFeature = async (mod: ToggleFeature) => {
    if (!list || pendingModules) return;
    const next = modules.includes(mod) ? modules.filter((m) => m !== mod) : [...modules, mod];
    setPendingModules(next);
    try {
      const preview = await previewListConfig(id, { modules: next }, token);
      let acknowledgedWarnings: string[] | undefined;
      if (preview.warnings.length > 0) {
        const first = preview.warnings[0];
        const copy = first ? featureWarningCopy(first, kind) : null;
        const ok = copy
          ? await confirm({
              title: copy.title,
              message: preview.warnings
                .map((w) => featureWarningCopy(w, kind).message)
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
        // Confirmed a destructive feature change (the Switch already ticked).
        haptics.warning();
        acknowledgedWarnings = preview.warnings.map((w) => w.code);
      }
      setStatus("saving");
      const res = await updateList(
        id,
        { modules: next, ...(acknowledgedWarnings ? { acknowledgedWarnings } : {}) },
        token,
      );
      // The server's modules, which carry the derived `sources`.
      patchCaches({ modules: res.list.modules });
      setStatus("saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) }),
      ]);
    } catch (e) {
      setStatus("idle");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't change that feature."),
        tone: "danger",
      });
    } finally {
      setPendingModules(null);
    }
  };

  // --- Other actions --------------------------------------------------------
  const duplicateMutation = useMutation({
    mutationFn: () => duplicateList(id, {}, token),
    // A create: `success`, on the tap.
    onMutate: () => haptics.success(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      openListOverHome(res.list.id);
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't duplicate the list."),
        tone: "danger",
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
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't hand over the list."),
        tone: "danger",
      });
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
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't remove that member."),
        tone: "danger",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => archiveListEntirely(id, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.dismissTo("/");
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't delete the list."),
        tone: "danger",
      });
    },
  });

  // 0.1: irreversible actions confirm first and name the list or the person.
  const listLabel = list ? `“${list.name}”` : "this list";
  const onDeleteList = async () => {
    const ok = await confirm({
      title: `Delete ${listLabel}?`,
      message: "Everyone on it loses access. This can't be undone.",
      confirmLabel: "Delete list",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    deleteMutation.mutate();
  };
  const onLeaveList = async () => {
    if (!user) return;
    const ok = await confirm({
      title: `Leave ${listLabel}?`,
      message: "You lose access until someone shares the link with you again.",
      confirmLabel: "Leave list",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    removeMemberMutation.mutate(user.id);
  };
  const onRemoveMember = async (member: ListMemberSummary) => {
    const who = member.displayName ?? "this member";
    const ok = await confirm({
      title: `Remove ${who} from ${listLabel}?`,
      message: "They lose access to the list. Items they added stay.",
      confirmLabel: "Remove member",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    removeMemberMutation.mutate(member.userId);
  };
  const onMakeOwner = async (member: ListMemberSummary) => {
    const who = member.displayName ?? "this member";
    const ok = await confirm({
      title: `Make ${who} the owner of ${listLabel}?`,
      message: "You become a member and can no longer change its settings or delete it.",
      confirmLabel: "Make owner",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    transferMutation.mutate(member.userId);
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
        <Text>This link is incomplete. Open the list from your lists.</Text>
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
        contentContainerStyle={[styles.body, screenColumnStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        {!list && listQuery.isPending ? (
          <View testID="settings-skeleton">
            <Skeleton.Block width={72} height={12} style={styles.skeletonInset} />
            <Skeleton.Rows count={3} badge={44} />
            <Skeleton.Block width={72} height={12} style={styles.skeletonGap} />
            <Skeleton.Block height={44} radius={tokens.radius.md} style={styles.skeletonInset} />
          </View>
        ) : list ? (
          <Reveal when={settingsRevealed} fill={false}>
            {/* --- Members, with sharing first --- */}
            <View>
              <SectionHeader
                title="Members"
                trailing={
                  <Text variant="caption" tone="muted">
                    {members.length}
                  </Text>
                }
                first
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
              <View>
                <SectionHeader title="Details" />
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
                    <EmojiChoices
                      choices={emojiChoices}
                      value={list.emoji}
                      onChange={(choice) => save({ patch: { emoji: choice }, label: "emoji" })}
                      testIDPrefix="settings"
                    />
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
                    <ColorChoices
                      choices={COLOR_KEYS}
                      value={list.color}
                      onChange={(key) =>
                        save({ patch: { color: key as ListColor }, label: "color" })
                      }
                      testIDPrefix="settings"
                    />
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
                            if (!picked) return;
                            haptics.light();
                            save({ patch: { coverPhotoUrl: picked.dataUrl }, label: "photo" });
                          }}
                        />
                        {list.coverPhotoUrl ? (
                          <Button
                            testID="settings-cover-remove"
                            label="Remove"
                            variant="ghost"
                            onPress={() => {
                              haptics.light();
                              save({ patch: { coverPhotoUrl: null }, label: "photo" });
                            }}
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

            {/* --- Features (owner): only what this kind of list offers --- */}
            {isOwner ? (
              <View testID="settings-features">
                <SectionHeader title="Features" />
                <ListRow
                  title="Holds"
                  trailing={
                    <Text tone="secondary" testID="settings-kind">
                      {kind.label}
                    </Text>
                  }
                  style={styles.kindRow}
                />
                <View style={styles.fields}>
                  {kind.features.map((f) => {
                    const copy = featureCopy(list.itemKind, f);
                    return (
                      <View key={f} style={styles.feature}>
                        <Switch
                          label={copy.label}
                          description={copy.description}
                          value={modules.includes(f)}
                          disabled={!!pendingModules}
                          onValueChange={() => void toggleFeature(f)}
                          testID={`settings-module-${f}`}
                        />
                        {f === "letterboxd" && !user?.letterboxdUsername ? (
                          // Matching reads each member's watchlist, so it
                          // points to Settings → Connections first.
                          <ListRow
                            title="Connect your Letterboxd"
                            subtitle="Matching needs your Letterboxd username."
                            chevron
                            onPress={() => router.push("/settings")}
                            style={styles.inlineRow}
                            testID="settings-letterboxd-connect"
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* --- Synced from: kinds with a source (album shelf, movies) --- */}
            <SyncedFrom
              listId={id}
              itemKind={list.itemKind}
              sources={sources}
              isOwner={isOwner}
              token={token}
            />

            {/* --- Duplicate --- */}
            <View style={styles.section}>
              <ListRow
                title="Duplicate list"
                subtitle={
                  kind.syncSources.length > 0
                    ? "Copies the items. Checked-off state and syncing start fresh."
                    : "Copies the items. Checked-off state starts fresh."
                }
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
            <View>
              <SectionHeader title={isOwner ? "Delete list" : "Leave list"} />
              <View style={styles.fields}>
                <Text tone="secondary">
                  {isOwner
                    ? "Deletes the list for everyone on it. This can't be undone."
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
          </Reveal>
        ) : (
          <View style={styles.message}>
            <Text tone="secondary">
              {listQuery.isError
                ? `Couldn't load this list. ${loadErrorMessage(listQuery.error)}`
                : ""}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingTop: layout.contentTopGap, paddingBottom: layout.bottomInset },
  saved: { paddingHorizontal: tokens.space.sm },
  // A block with no section label still keeps the section rhythm.
  section: { paddingTop: layout.sectionTop },
  message: { paddingHorizontal: layout.gutter },
  fields: { gap: tokens.space.lg, paddingHorizontal: layout.gutter },
  field: { gap: tokens.space.sm },
  skeletonInset: { marginHorizontal: layout.gutter },
  skeletonGap: { marginHorizontal: layout.gutter, marginTop: layout.sectionTop },
  shareMark: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
  },
  memberAvatar: { width: 44, height: 44, borderRadius: tokens.radius.pill },
  coverRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  coverButtons: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap", flex: 1 },
  coverPreview: { width: 64, height: 64, borderRadius: tokens.radius.md },
  coverPreviewEmpty: {
    backgroundColor: tokens.bg.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  coverPreviewEmoji: { fontSize: tokens.font.size.xxl, lineHeight: tokens.font.lineHeight.xxl },
  kindRow: { minHeight: tokens.hit },
  feature: { gap: tokens.space.xs },
  inlineRow: { marginHorizontal: 0, paddingHorizontal: 0 },
  dangerRow: { flexDirection: "row" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
