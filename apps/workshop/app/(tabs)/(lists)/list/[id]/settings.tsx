import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  ConfigWarning,
  ListColor,
  ListMemberSummary,
  ListSource,
  ModuleName,
  ShareVisibility,
} from "@workshop/shared";
import { formatConfigWarning, MODULE_NAMES } from "@workshop/shared/modules";
import {
  Avatar,
  Button,
  confirm,
  EmojiBadge,
  formatRelative,
  type ListColorKey,
  RadioRow,
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
import { useEffect, useMemo, useState } from "react";
import { Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  archiveListEntirely,
  duplicateList,
  fetchListDetail,
  previewListConfig,
  updateList,
} from "../../../../../src/api/lists";
import { removeMember } from "../../../../../src/api/members";
import {
  resetListShareSlug,
  SHARE_VISIBILITY_LABELS,
  transferOwnership,
  updateListShare,
} from "../../../../../src/api/share";
import { syncSource } from "../../../../../src/api/sources";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { pickCoverPhoto } from "../../../../../src/lib/coverPhoto";
import { goBack } from "../../../../../src/lib/goBack";
import { buildListShareUrl, copyToClipboard } from "../../../../../src/lib/share";
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

const MODULE_LABELS: Record<ModuleName, { label: string; description: string }> = {
  todo: {
    label: "To-do",
    description: "Mark items as done.",
  },
  ranking: {
    label: "Ranking",
    description: "Sort items by hand.",
  },
  leaderboard: {
    label: "Leaderboard",
    description: "Post scores for daily games.",
  },
  letterboxd: {
    label: "Letterboxd",
    description: "Match members' watchlists and suggest films.",
  },
  sources: {
    label: "Sources",
    description: "Sync from external feeds.",
  },
};

const EDITABLE_MODULE_NAMES = MODULE_NAMES.filter((mod) => mod !== "leaderboard");

export default function ListSettings() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id ?? ""),
    queryFn: () => fetchListDetail(id ?? "", token),
    enabled: !!token && !!id,
  });

  const list = listQuery.data?.list;
  const members = listQuery.data?.members ?? [];
  const sources: ListSource[] = listQuery.data?.sources ?? [];
  const isOwner = !!list && !!user && list.ownerId === user.id;

  const [name, setName] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [color, setColor] = useState<ListColor | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [coverPhotoLoaded, setCoverPhotoLoaded] = useState(false);
  const [selectedModules, setSelectedModules] = useState<ModuleName[] | null>(null);

  if (list && name === null && emoji === null && color === null && description === null) {
    setName(list.name);
    setEmoji(list.emoji);
    setColor(list.color);
    setDescription(list.description ?? "");
    setSelectedModules(list.modules);
  }
  if (list && !coverPhotoLoaded) {
    setCoverPhotoUrl(list.coverPhotoUrl ?? null);
    setCoverPhotoLoaded(true);
  }

  const detailsDirty = useMemo(() => {
    if (!list || name === null || emoji === null || color === null || description === null) {
      return false;
    }
    const desc = description.trim();
    const currentDesc = list.description ?? "";
    const currentCover = list.coverPhotoUrl ?? null;
    return (
      name.trim() !== list.name ||
      emoji !== list.emoji ||
      color !== list.color ||
      desc !== currentDesc ||
      coverPhotoUrl !== currentCover
    );
  }, [list, name, emoji, color, description, coverPhotoUrl]);

  const modulesDirty = useMemo(() => {
    if (!list || !selectedModules) return false;
    if (selectedModules.length !== list.modules.length) return true;
    const a = [...selectedModules].sort().join(",");
    const b = [...list.modules].sort().join(",");
    return a !== b;
  }, [list, selectedModules]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!id || name === null || emoji === null || color === null || description === null) {
        throw new Error("invalid form state");
      }
      const desc = description.trim();
      const currentCover = list?.coverPhotoUrl ?? null;
      return updateList(
        id,
        {
          name: name.trim(),
          emoji,
          color,
          description: desc.length > 0 ? desc : null,
          ...(coverPhotoUrl !== currentCover ? { coverPhotoUrl } : {}),
        },
        token,
      );
    },
    onSuccess: async () => {
      if (!id) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
      ]);
      showToast({ message: "Saved", tone: "success" });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't save list"),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => updateMutation.mutate(),
      });
    },
  });

  // --- Module changes ---
  const [previewWarnings, setPreviewWarnings] = useState<ConfigWarning[] | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!id || !selectedModules) throw new Error("missing");
      return previewListConfig(id, { modules: selectedModules }, token);
    },
    onSuccess: (res) => {
      setPreviewWarnings(res.warnings);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't preview changes"), tone: "danger" });
    },
  });

  const modulesMutation = useMutation({
    mutationFn: ({ acknowledgedWarnings }: { acknowledgedWarnings?: string[] }) => {
      if (!id || !selectedModules) throw new Error("missing");
      return updateList(
        id,
        {
          modules: selectedModules,
          ...(acknowledgedWarnings ? { acknowledgedWarnings } : {}),
        },
        token,
      );
    },
    onSuccess: async () => {
      if (!id) return;
      setPreviewWarnings(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) }),
      ]);
      showToast({ message: "Modules updated", tone: "success" });
    },
    onError: (e, vars) => {
      showToast({
        message: errorMessage(e, "Couldn't update modules"),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => modulesMutation.mutate(vars),
      });
    },
  });

  const toggleModule = (mod: ModuleName) => {
    if (!selectedModules) return;
    setSelectedModules(
      selectedModules.includes(mod)
        ? selectedModules.filter((m) => m !== mod)
        : [...selectedModules, mod],
    );
    setPreviewWarnings(null);
  };

  const onSaveModules = () => {
    if (!selectedModules) return;
    // First preview — if there are no warnings (or user already acknowledged),
    // commit directly. Runs through `previewMutation` so the Save button
    // spins while the preview is in flight and a failure shows a toast
    // (the old direct call had neither and left an unhandled rejection).
    previewMutation.mutate(undefined, {
      onSuccess: (result) => {
        if (result.warnings.length === 0) modulesMutation.mutate({});
      },
    });
  };

  const onConfirmModules = () => {
    if (!previewWarnings) return;
    modulesMutation.mutate({
      acknowledgedWarnings: previewWarnings.map((w) => w.code),
    });
  };

  // --- Duplicate ---
  const duplicateMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return duplicateList(id, {}, token);
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace(`/list/${res.list.id}`);
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't duplicate"),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => duplicateMutation.mutate(),
      });
    },
  });

  // --- Source sync ---
  const syncMutation = useMutation({
    mutationFn: (sourceId: string) => {
      if (!id) throw new Error("missing list id");
      return syncSource(id, sourceId, token);
    },
    onSuccess: async (res) => {
      if (!id) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(id) }),
      ]);
      showToast({
        message:
          res.addedCount === 0
            ? "No new items detected."
            : `Detected ${res.addedCount} new item${res.addedCount === 1 ? "" : "s"}.`,
        tone: res.addedCount === 0 ? "default" : "success",
      });
    },
    onError: (e, sourceId) => {
      showToast({
        message: sourceErrorMessage(e, "Couldn't refresh."),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => syncMutation.mutate(sourceId),
      });
    },
  });

  const shareVisibilityMutation = useMutation({
    mutationFn: (visibility: ShareVisibility) => {
      if (!id) throw new Error("missing list id");
      return updateListShare(id, { visibility }, token);
    },
    onSuccess: async () => {
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't update sharing"), tone: "danger" });
    },
  });

  const resetSlugMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return resetListShareSlug(id, token);
    },
    onSuccess: async (res) => {
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      const url = buildListShareUrl(res.shareSlug);
      const copied = await copyToClipboard(url);
      showToast({
        message: copied ? "New link copied" : "New link generated",
        tone: copied ? "success" : "default",
      });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't reset link"),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => resetSlugMutation.mutate(),
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: (newOwnerId: string) => {
      if (!id) throw new Error("missing list id");
      return transferOwnership(id, newOwnerId, token);
    },
    onSuccess: async () => {
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({ message: "Ownership transferred", tone: "success" });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't transfer ownership"),
        tone: "danger",
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => {
      if (!id) throw new Error("missing list id");
      return removeMember(id, userId, token);
    },
    onSuccess: async (_res, removedUserId) => {
      const isSelfLeave = !!user && removedUserId === user.id;
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      if (isSelfLeave) router.replace("/");
      else showToast({ message: "Member removed", tone: "default" });
    },
    onError: (e, userId) => {
      showToast({
        message: errorMessage(e, "Couldn't remove member"),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => removeMemberMutation.mutate(userId),
      });
    },
  });

  const archiveListMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return archiveListEntirely(id, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace("/");
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't delete list"), tone: "danger" });
    },
  });

  // 0.1: irreversible actions confirm first, and the dialog names the list or
  // the person so a mis-tap can't silently delete, leave, or hand off a list.
  const listLabel = list ? `“${list.name}”` : "this list";

  const onDeleteList = async () => {
    const ok = await confirm({
      title: `Delete ${listLabel}?`,
      message: "Everyone on it loses access.",
      confirmLabel: "Delete list",
      destructive: true,
    });
    if (ok) archiveListMutation.mutate();
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

  const onResetLink = async () => {
    const ok = await confirm({
      title: `Reset the link for ${listLabel}?`,
      message: "The current link stops working everywhere it has been shared. Members keep access.",
      confirmLabel: "Reset link",
      destructive: true,
    });
    if (ok) resetSlugMutation.mutate();
  };

  const discardDetails = () => {
    if (!list) return;
    setName(list.name);
    setEmoji(list.emoji);
    setColor(list.color);
    setDescription(list.description ?? "");
    setCoverPhotoUrl(list.coverPhotoUrl ?? null);
  };

  const discardModules = () => {
    if (!list) return;
    setSelectedModules(list.modules);
    setPreviewWarnings(null);
  };

  // Esc closes settings on web. Cmd/Ctrl+Enter saves the first dirty
  // section so power users can edit + save without reaching for the
  // mouse. Native users get the back gesture / system dismiss instead.
  // Skip Esc when an input is focused so the same key still clears
  // intent inside textfields without bouncing them out of the screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mutation objects are stable; including them would tear down/recreate the listener on every render.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const inInput = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
        if (inInput) return;
        e.preventDefault();
        goBack(`/list/${id ?? ""}`);
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (detailsDirty && !updateMutation.isPending) {
          e.preventDefault();
          updateMutation.mutate();
        } else if (modulesDirty && !modulesMutation.isPending && !previewMutation.isPending) {
          e.preventDefault();
          onSaveModules();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [id, detailsDirty, modulesDirty]);

  if (!id) {
    return (
      <Screen style={styles.center}>
        <Text>Missing list id</Text>
      </Screen>
    );
  }

  const headerAccent: string = list
    ? (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default
    : tokens.accent.default;

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="close"
        onLeadingPress={() => goBack(`/list/${id}`)}
        leadingLabel="Close settings"
        leadingTestID="settings-close"
        eyebrow="Settings"
        title={list?.name ?? "List settings"}
        titleAccessory={
          list ? <EmojiBadge emoji={emoji ?? list.emoji} color={headerAccent} size={44} /> : null
        }
      />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        {/* First load: placeholders shaped like the details and members
            sections, instead of member-only chrome ("Leave list") flashing
            before the list resolves. */}
        {!list && listQuery.isPending ? (
          <View style={styles.section} testID="settings-skeleton">
            <Skeleton.Block width={72} height={12} />
            <Skeleton.Block height={44} radius={tokens.radius.md} />
            <Skeleton.Block height={44} radius={tokens.radius.md} />
            <Skeleton.Block width={120} height={12} style={styles.skeletonGap} />
            <Skeleton.Rows count={2} badge={24} />
          </View>
        ) : (
          <>
            {/* --- Details --- */}
            {isOwner ? (
              <View style={styles.section}>
                <SectionHeader title="Details" />
                <TextField
                  label="Name"
                  testID="settings-name"
                  value={name ?? ""}
                  onChangeText={setName}
                  maxLength={100}
                />
                <View style={styles.field}>
                  <Text variant="label" tone="secondary" style={styles.fieldLabel}>
                    Cover photo
                  </Text>
                  <View style={styles.coverRow}>
                    {coverPhotoUrl ? (
                      <Image
                        source={{ uri: coverPhotoUrl }}
                        style={styles.coverPreview}
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <View style={[styles.coverPreview, styles.coverPreviewEmpty]}>
                        <Text style={styles.coverPreviewEmoji}>{emoji ?? list?.emoji ?? "🖼"}</Text>
                      </View>
                    )}
                    <View style={styles.coverButtons}>
                      <Button
                        testID="settings-cover-pick"
                        label={coverPhotoUrl ? "Change photo" : "Upload photo"}
                        variant="secondary"
                        size="md"
                        onPress={async () => {
                          const picked = await pickCoverPhoto();
                          if (picked) setCoverPhotoUrl(picked.dataUrl);
                        }}
                      />
                      {coverPhotoUrl ? (
                        <Button
                          testID="settings-cover-remove"
                          label="Remove"
                          variant="secondary"
                          size="md"
                          onPress={() => setCoverPhotoUrl(null)}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
                <View style={styles.field}>
                  <Text variant="label" tone="secondary" style={styles.fieldLabel}>
                    Emoji
                  </Text>
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
                  <Text variant="label" tone="secondary" style={styles.fieldLabel}>
                    Color
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
                        style={styles.colorTarget}
                      >
                        {({ pressed }) => (
                          <View
                            style={[
                              styles.colorCell,
                              { backgroundColor: tokens.list[key] },
                              key === color && styles.colorCellSelected,
                              pressed && styles.colorCellPressed,
                            ]}
                          />
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>
                <TextField
                  label="Description"
                  testID="settings-description"
                  value={description ?? ""}
                  onChangeText={setDescription}
                  multiline
                  maxLength={280}
                />
                <View style={styles.actionRow}>
                  <Button
                    testID="settings-save"
                    label="Save changes"
                    size="md"
                    disabled={!detailsDirty || updateMutation.isPending}
                    loading={updateMutation.isPending}
                    onPress={() => updateMutation.mutate()}
                    style={styles.actionPrimary}
                  />
                  {detailsDirty ? (
                    <Button
                      testID="settings-discard"
                      label="Discard"
                      variant="ghost"
                      size="md"
                      disabled={updateMutation.isPending}
                      onPress={discardDetails}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* --- Modules (owner-only) --- */}
            {isOwner && selectedModules ? (
              <View style={styles.section}>
                <SectionHeader title="Modules" />
                <View style={styles.moduleList}>
                  {EDITABLE_MODULE_NAMES.map((mod) => {
                    const labels = MODULE_LABELS[mod];
                    return (
                      <Switch
                        key={mod}
                        label={labels.label}
                        description={labels.description}
                        value={selectedModules.includes(mod)}
                        onValueChange={() => toggleModule(mod)}
                        testID={`settings-module-${mod}`}
                      />
                    );
                  })}
                </View>
                {previewWarnings && previewWarnings.length > 0 ? (
                  <View style={styles.warningBox}>
                    {previewWarnings.map((w) => {
                      const copy = formatConfigWarning(w);
                      return (
                        <View key={w.code} style={styles.warningEntry}>
                          <Text variant="label" tone="danger">
                            {copy.headline}
                          </Text>
                          <Text tone="secondary">{copy.detail}</Text>
                        </View>
                      );
                    })}
                    <Button
                      testID="settings-modules-confirm"
                      label="Apply anyway"
                      variant="danger"
                      size="md"
                      loading={modulesMutation.isPending}
                      onPress={onConfirmModules}
                    />
                  </View>
                ) : null}
                <View style={styles.actionRow}>
                  <Button
                    testID="settings-modules-save"
                    label="Save"
                    size="md"
                    disabled={
                      !modulesDirty || modulesMutation.isPending || previewMutation.isPending
                    }
                    loading={modulesMutation.isPending || previewMutation.isPending}
                    onPress={onSaveModules}
                    style={styles.actionPrimary}
                  />
                  {modulesDirty ? (
                    <Button
                      testID="settings-modules-discard"
                      label="Discard"
                      variant="ghost"
                      size="md"
                      disabled={modulesMutation.isPending || previewMutation.isPending}
                      onPress={discardModules}
                    />
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* --- Members --- */}
            <View style={styles.section}>
              <SectionHeader title="Members" />
              <View style={styles.memberList}>
                {members.map((m) => (
                  <MemberRow
                    key={m.userId}
                    member={m}
                    isCurrentUser={!!user && m.userId === user.id}
                    isOwner={isOwner}
                    disabled={removeMemberMutation.isPending || transferMutation.isPending}
                    onRemove={() => void onRemoveMember(m)}
                    onMakeOwner={() => void onMakeOwner(m)}
                  />
                ))}
              </View>
            </View>

            {/* --- Sources --- */}
            {sources.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Sources" />
                {sources.map((src) => {
                  // Each source kind stashes its primary URL on a kind-specific
                  // config field. Extending this means one more case here.
                  const sourceUrl: string | null =
                    src.kind === "spotify_playlist" &&
                    typeof src.config.spotifyPlaylistUrl === "string"
                      ? src.config.spotifyPlaylistUrl
                      : src.kind === "letterboxd_list" &&
                          typeof src.config.letterboxdUrl === "string"
                        ? src.config.letterboxdUrl
                        : null;
                  return (
                    <View key={src.id} style={styles.field}>
                      <Text variant="label">{src.kind.replace(/_/g, " ")}</Text>
                      {sourceUrl ? (
                        <Pressable
                          accessibilityRole="link"
                          onPress={() => {
                            Linking.openURL(sourceUrl).catch(() => {});
                          }}
                          testID={`settings-source-${src.id}-open`}
                          style={styles.sourceLink}
                        >
                          <Text style={styles.urlText} numberOfLines={1}>
                            {sourceUrl}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Text variant="caption" tone="muted">
                        {src.lastSyncedAt
                          ? `Last synced ${formatRelative(src.lastSyncedAt)}`
                          : "Not yet synced."}
                      </Text>
                      <Button
                        testID={`settings-source-${src.id}-sync`}
                        label="Refresh now"
                        variant="secondary"
                        size="md"
                        loading={syncMutation.isPending}
                        disabled={syncMutation.isPending}
                        onPress={() => syncMutation.mutate(src.id)}
                      />
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* --- Duplicate --- */}
            <View style={styles.section}>
              <SectionHeader title="Duplicate" />
              <Text tone="secondary">
                Make a copy of this list. Items come along, but completion and sources start fresh.
              </Text>
              <Button
                testID="settings-duplicate-list"
                label="Duplicate list"
                variant="secondary"
                size="md"
                loading={duplicateMutation.isPending}
                disabled={duplicateMutation.isPending}
                onPress={() => duplicateMutation.mutate()}
              />
            </View>

            {/* --- Share link (owner-only) --- */}
            {isOwner && list ? (
              <View style={styles.section}>
                <SectionHeader title="Share link" />
                <View style={styles.field}>
                  <View style={styles.urlBox}>
                    <Text
                      style={styles.urlText}
                      numberOfLines={1}
                      selectable
                      testID="settings-share-url"
                    >
                      {buildListShareUrl(list.shareSlug)}
                    </Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Button
                      testID="settings-copy-link"
                      label="Copy link"
                      variant="secondary"
                      size="md"
                      onPress={async () => {
                        const ok = await copyToClipboard(buildListShareUrl(list.shareSlug));
                        showToast({
                          message: ok ? "Copied" : "Couldn't copy. Copy the link manually.",
                          tone: ok ? "success" : "danger",
                        });
                      }}
                    />
                    <Button
                      testID="settings-reset-link"
                      label="Reset link"
                      variant="ghost"
                      size="md"
                      loading={resetSlugMutation.isPending}
                      disabled={resetSlugMutation.isPending}
                      onPress={() => void onResetLink()}
                    />
                  </View>
                  <Text variant="caption" tone="muted">
                    Resetting kills the current link everywhere it's been pasted. Existing members
                    keep access.
                  </Text>
                </View>
                <View
                  style={styles.visibilityList}
                  role="radiogroup"
                  aria-label="Who can use the share link"
                >
                  {(["join", "view", "off"] as const).map((opt) => {
                    const labels = SHARE_VISIBILITY_LABELS[opt];
                    return (
                      <RadioRow
                        key={opt}
                        label={labels.title}
                        description={labels.help}
                        selected={list.shareVisibility === opt}
                        onSelect={() => shareVisibilityMutation.mutate(opt)}
                        testID={`settings-visibility-${opt}`}
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={[styles.section, styles.sectionDanger]}>
              <SectionHeader title="Danger zone" />
              {isOwner ? (
                <>
                  <Text tone="secondary">
                    Deleting archives the list and removes it from everyone&apos;s home. Items stay
                    recoverable but no one can see them.
                  </Text>
                  <Button
                    testID="settings-delete-list"
                    label="Delete list"
                    variant="danger"
                    size="md"
                    loading={archiveListMutation.isPending}
                    disabled={archiveListMutation.isPending}
                    onPress={() => void onDeleteList()}
                  />
                </>
              ) : (
                <>
                  <Text tone="secondary">Items you added stay on the list.</Text>
                  <Button
                    testID="settings-leave-list"
                    label="Leave list"
                    variant="danger"
                    size="md"
                    loading={removeMemberMutation.isPending}
                    disabled={!user || removeMemberMutation.isPending}
                    onPress={() => void onLeaveList()}
                  />
                </>
              )}
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

interface MemberRowProps {
  member: ListMemberSummary;
  isCurrentUser: boolean;
  isOwner: boolean;
  disabled: boolean;
  onRemove: () => void;
  onMakeOwner: () => void;
}

function MemberRow({
  member,
  isCurrentUser,
  isOwner,
  disabled,
  onRemove,
  onMakeOwner,
}: MemberRowProps) {
  const canRemove = isOwner && !isCurrentUser && member.role !== "owner";
  const canPromote = isOwner && !isCurrentUser && member.role !== "owner";
  return (
    <View style={styles.memberRow} testID={`settings-member-${member.userId}`}>
      <Avatar
        name={member.displayName}
        imageUrl={userAvatarImageUrl(member.userId)}
        size="md"
        style={styles.memberAvatar}
      />
      <View style={styles.memberInfo}>
        <Text variant="body" numberOfLines={1}>
          {member.displayName ?? "(no name)"}
          {isCurrentUser ? " · you" : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {member.role === "owner" ? "Owner" : "Member"}
        </Text>
      </View>
      {canPromote ? (
        <Button
          testID={`settings-make-owner-${member.userId}`}
          label="Make owner"
          variant="ghost"
          size="md"
          disabled={disabled}
          onPress={onMakeOwner}
        />
      ) : null}
      {canRemove ? (
        <Button
          testID={`settings-remove-${member.userId}`}
          label="Remove"
          variant="secondary"
          size="md"
          disabled={disabled}
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
  },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
  },
  section: {
    gap: tokens.space.md,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
  },
  sectionDanger: {
    marginTop: tokens.space.md,
  },
  field: { gap: tokens.space.sm },
  fieldLabel: { marginLeft: tokens.space.xxs },
  skeletonGap: { marginTop: tokens.space.md },
  sourceLink: { minHeight: tokens.hit, justifyContent: "center" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginTop: tokens.space.xs,
  },
  actionPrimary: { flexShrink: 0 },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
  emojiCellSelected: { borderColor: tokens.accent.default, backgroundColor: tokens.accent.muted },
  emojiCellPressed: { opacity: 0.7 },
  emojiGlyph: { fontSize: tokens.font.size.lg },
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
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
  },
  coverRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  coverButtons: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap", flex: 1 },
  coverPreview: { width: 64, height: 64, borderRadius: tokens.radius.md },
  coverPreviewEmpty: {
    backgroundColor: tokens.bg.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  // lineHeight pinned so the 28px list emoji isn't clipped to the shared Text
  // body line box (22) on iOS.
  coverPreviewEmoji: { fontSize: 28, lineHeight: 32 },
  colorCellSelected: { borderColor: tokens.text.primary },
  colorCellPressed: { opacity: 0.8 },
  memberList: { gap: tokens.space.sm },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.space.sm,
    gap: tokens.space.md,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  memberInfo: { flex: 1, gap: tokens.space.xxs },
  visibilityList: { gap: tokens.space.xs, marginTop: tokens.space.sm },
  urlBox: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    backgroundColor: tokens.bg.surface,
  },
  urlText: { color: tokens.text.primary, fontSize: tokens.font.size.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  moduleList: { gap: tokens.space.sm },
  warningBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  warningEntry: {
    gap: tokens.space.xs,
  },
});
