import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConfigWarning,
  Invite,
  ListColor,
  ListMemberSummary,
  ListSource,
  ModuleName,
  PendingInvite,
} from "@workshop/shared";
import { MODULE_NAMES } from "@workshop/shared/modules";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { createInvite, revokeInvite } from "../../../src/api/invites";
import {
  archiveListEntirely,
  duplicateList,
  fetchListDetail,
  previewListConfig,
  updateList,
} from "../../../src/api/lists";
import { removeMember } from "../../../src/api/members";
import { syncSource } from "../../../src/api/sources";
import { useAuth } from "../../../src/hooks/useAuth";
import { albumShelfErrorMessage } from "../../../src/lib/albumShelfErrors";
import { errorMessage } from "../../../src/lib/api";
import { pickCoverPhoto } from "../../../src/lib/coverPhoto";
import { goBack } from "../../../src/lib/goBack";
import { queryKeys } from "../../../src/lib/queryKeys";
import { formatRelative } from "../../../src/lib/relativeTime";
import { buildInviteShareUrl, copyToClipboard } from "../../../src/lib/share";
import {
  Button,
  Card,
  IconButton,
  type ListColorKey,
  Text,
  tokens,
  useToast,
} from "../../../src/ui/index";

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
    description: "Items can be marked complete; a “Done” section appears.",
  },
  voting: {
    label: "Voting",
    description: "Members can upvote items.",
  },
  ranking: {
    label: "Ranking",
    description: "Drag items into a manual order.",
  },
  leaderboard: {
    label: "Leaderboard",
    description: "Members submit scores per period — great for daily games.",
  },
  sources: {
    label: "Sources",
    description: "Attach external feeds (Spotify playlists, future kinds).",
  },
};

interface FreshInvite extends Invite {
  token: string;
}

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
  const pendingInvites = listQuery.data?.pendingInvites ?? [];
  const sources: ListSource[] = listQuery.data?.sources ?? [];
  const isOwner = !!list && !!user && list.ownerId === user.id;

  const [freshInvite, setFreshInvite] = useState<FreshInvite | null>(null);

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
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't update modules"), tone: "danger" });
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

  const onSaveModules = async () => {
    if (!selectedModules) return;
    // First preview — if there are no warnings (or user already acknowledged),
    // commit directly.
    const result = await previewListConfig(id ?? "", { modules: selectedModules }, token);
    if (result.warnings.length === 0) {
      modulesMutation.mutate({});
    } else {
      setPreviewWarnings(result.warnings);
    }
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
      showToast({ message: errorMessage(e, "Couldn't duplicate"), tone: "danger" });
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
    onError: (e) => {
      showToast({ message: albumShelfErrorMessage(e, "Couldn't refresh."), tone: "danger" });
    },
  });

  const generateInviteMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return createInvite(id, {}, token);
    },
    onSuccess: async (res) => {
      const fresh = res.invite;
      if (!fresh.token) {
        showToast({
          message: "Invite created but token missing — revoke and retry.",
          tone: "danger",
        });
        return;
      }
      setFreshInvite({ ...fresh, token: fresh.token });
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      const url = buildInviteShareUrl(fresh.token);
      const ok = await copyToClipboard(url);
      showToast({
        message: ok ? "Share link copied to clipboard" : "Share link generated",
        tone: ok ? "success" : "default",
      });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't generate invite"), tone: "danger" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => {
      if (!id) throw new Error("missing list id");
      return revokeInvite(id, inviteId, token);
    },
    onSuccess: async (_res, inviteId) => {
      setFreshInvite((prev) => (prev && prev.id === inviteId ? null : prev));
      if (id) await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      showToast({ message: "Share link revoked", tone: "default" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't revoke invite"), tone: "danger" });
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
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove member"), tone: "danger" });
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
      showToast({ message: errorMessage(e, "Couldn't archive list"), tone: "danger" });
    },
  });

  if (!id) {
    return (
      <View style={styles.center}>
        <Text>Missing list id</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text variant="heading">List settings</Text>
        <IconButton
          accessibilityLabel="Close settings"
          onPress={() => goBack(`/list/${id}`)}
          testID="settings-close"
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </IconButton>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        {/* --- Details --- */}
        {isOwner ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Details
            </Text>
            <View style={styles.field}>
              <Text variant="caption" tone="muted">
                Name
              </Text>
              <TextInput
                testID="settings-name"
                value={name ?? ""}
                onChangeText={setName}
                maxLength={100}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text variant="caption" tone="muted">
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
              <Text variant="caption" tone="muted">
                Emoji
              </Text>
              <View style={styles.emojiRow}>
                {EMOJI_CHOICES.map((choice) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityLabel={`Use emoji ${choice}`}
                    accessibilityState={{ selected: choice === emoji }}
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
              <Text variant="caption" tone="muted">
                Color
              </Text>
              <View style={styles.colorRow}>
                {COLOR_KEYS.map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={`Use color ${key}`}
                    accessibilityState={{ selected: key === color }}
                    onPress={() => setColor(key)}
                    style={({ pressed }) => [
                      styles.colorCell,
                      { backgroundColor: tokens.list[key] },
                      key === color && styles.colorCellSelected,
                      pressed && styles.colorCellPressed,
                    ]}
                  />
                ))}
              </View>
            </View>
            <View style={styles.field}>
              <Text variant="caption" tone="muted">
                Description
              </Text>
              <TextInput
                testID="settings-description"
                value={description ?? ""}
                onChangeText={setDescription}
                multiline
                maxLength={280}
                style={[styles.input, styles.inputMultiline]}
              />
            </View>
            <Button
              testID="settings-save"
              label="Save changes"
              size="md"
              disabled={!detailsDirty || updateMutation.isPending}
              loading={updateMutation.isPending}
              onPress={() => updateMutation.mutate()}
            />
          </Card>
        ) : null}

        {/* --- Modules (owner-only) --- */}
        {isOwner && selectedModules ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Modules
            </Text>
            <Text tone="secondary">
              What this list does. Disabling a module hides the feature but preserves the data —
              turn it back on to bring everything back.
            </Text>
            <View style={styles.moduleList}>
              {MODULE_NAMES.map((mod) => {
                const isOn = selectedModules.includes(mod);
                const labels = MODULE_LABELS[mod];
                return (
                  <Pressable
                    key={mod}
                    onPress={() => toggleModule(mod)}
                    testID={`settings-module-${mod}`}
                    style={({ pressed }) => [
                      styles.moduleRow,
                      isOn && styles.moduleRowOn,
                      pressed && styles.moduleRowPressed,
                    ]}
                  >
                    <View style={styles.moduleText}>
                      <Text variant="label">{labels.label}</Text>
                      <Text variant="caption" tone="muted">
                        {labels.description}
                      </Text>
                    </View>
                    <View style={[styles.toggle, isOn ? styles.toggleOn : styles.toggleOff]}>
                      <View style={[styles.toggleKnob, isOn ? styles.toggleKnobOn : null]} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {previewWarnings && previewWarnings.length > 0 ? (
              <View style={styles.warningBox}>
                <Text variant="label" tone="danger">
                  Heads up
                </Text>
                {previewWarnings.map((w) => (
                  <Text key={w.code} tone="secondary">
                    • {w.message}
                  </Text>
                ))}
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
            <Button
              testID="settings-modules-save"
              label="Save modules"
              size="md"
              disabled={!modulesDirty || modulesMutation.isPending || previewMutation.isPending}
              loading={modulesMutation.isPending || previewMutation.isPending}
              onPress={onSaveModules}
            />
          </Card>
        ) : null}

        {/* --- Members --- */}
        <Card style={styles.card} elevated>
          <Text variant="label" tone="secondary">
            Members
          </Text>
          <View style={styles.memberList}>
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                isCurrentUser={!!user && m.userId === user.id}
                isOwner={isOwner}
                disabled={removeMemberMutation.isPending}
                onPress={() => removeMemberMutation.mutate(m.userId)}
              />
            ))}
          </View>
        </Card>

        {/* --- Sources --- */}
        {sources.length > 0 ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Sources
            </Text>
            {sources.map((src) => (
              <View key={src.id} style={styles.field}>
                <Text variant="label">{src.kind.replace(/_/g, " ")}</Text>
                {src.kind === "spotify_playlist" &&
                typeof src.config.spotifyPlaylistUrl === "string" ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      const url = src.config.spotifyPlaylistUrl;
                      if (typeof url === "string") {
                        Linking.openURL(url).catch(() => {});
                      }
                    }}
                    testID={`settings-source-${src.id}-open`}
                  >
                    <Text style={styles.urlText} numberOfLines={1}>
                      {String(src.config.spotifyPlaylistUrl)}
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
            ))}
          </Card>
        ) : null}

        {/* --- Duplicate --- */}
        <Card style={styles.card} elevated>
          <Text variant="label" tone="secondary">
            Duplicate
          </Text>
          <Text tone="secondary">
            Make a copy of this list. Items come along, but votes, completion, and sources start
            fresh.
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
        </Card>

        {/* --- Share link (owner-only) --- */}
        {isOwner ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Share link
            </Text>
            <Text tone="secondary">
              Anyone with this link can join the list. Links expire after 7 days.
            </Text>
            {freshInvite ? (
              <View style={styles.field}>
                <Text variant="caption" tone="muted">
                  New link
                </Text>
                <View style={styles.urlBox}>
                  <Text
                    style={styles.urlText}
                    numberOfLines={1}
                    selectable
                    testID="settings-fresh-invite-url"
                  >
                    {buildInviteShareUrl(freshInvite.token)}
                  </Text>
                </View>
                <Button
                  testID="settings-copy-link"
                  label="Copy link"
                  variant="secondary"
                  size="md"
                  onPress={async () => {
                    const ok = await copyToClipboard(buildInviteShareUrl(freshInvite.token));
                    showToast({
                      message: ok ? "Copied" : "Couldn't copy — copy the link manually",
                      tone: ok ? "success" : "danger",
                    });
                  }}
                />
              </View>
            ) : null}
            <Button
              testID="settings-generate-link"
              label={freshInvite ? "Generate another link" : "Generate share link"}
              size="md"
              loading={generateInviteMutation.isPending}
              disabled={generateInviteMutation.isPending}
              onPress={() => generateInviteMutation.mutate()}
            />
            {pendingInvites.length > 0 ? (
              <View style={styles.inviteList}>
                <Text variant="caption" tone="muted">
                  Active links
                </Text>
                {pendingInvites.map((invite) => (
                  <PendingInviteRow
                    key={invite.id}
                    invite={invite}
                    busy={revokeMutation.isPending}
                    onRevoke={() => revokeMutation.mutate(invite.id)}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {isOwner ? (
          <Card style={styles.card} elevated>
            <Button
              testID="settings-delete-list"
              label="Delete list"
              variant="danger"
              size="md"
              loading={archiveListMutation.isPending}
              disabled={archiveListMutation.isPending}
              onPress={() => archiveListMutation.mutate()}
            />
          </Card>
        ) : (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Leave list
            </Text>
            <Text tone="secondary">
              Your upvotes will be removed but items you added will stay on the list.
            </Text>
            <Button
              testID="settings-leave-list"
              label="Leave list"
              variant="danger"
              size="md"
              loading={removeMemberMutation.isPending}
              disabled={!user || removeMemberMutation.isPending}
              onPress={() => {
                if (user) removeMemberMutation.mutate(user.id);
              }}
            />
          </Card>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

interface MemberRowProps {
  member: ListMemberSummary;
  isCurrentUser: boolean;
  isOwner: boolean;
  disabled: boolean;
  onPress: () => void;
}

function MemberRow({ member, isCurrentUser, isOwner, disabled, onPress }: MemberRowProps) {
  const canActOn = isOwner && !isCurrentUser && member.role !== "owner";
  return (
    <View style={styles.memberRow} testID={`settings-member-${member.userId}`}>
      <View style={styles.memberInfo}>
        <Text variant="body" numberOfLines={1}>
          {member.displayName ?? "(no name)"}
          {isCurrentUser ? " (you)" : ""}
        </Text>
        <Text variant="caption" tone="muted">
          {member.role === "owner" ? "Owner" : "Member"}
        </Text>
      </View>
      {canActOn ? (
        <Button
          testID={`settings-remove-${member.userId}`}
          label="Remove"
          variant="secondary"
          size="md"
          disabled={disabled}
          onPress={onPress}
        />
      ) : null}
    </View>
  );
}

interface PendingInviteRowProps {
  invite: PendingInvite;
  busy: boolean;
  onRevoke: () => void;
}

function PendingInviteRow({ invite, busy, onRevoke }: PendingInviteRowProps) {
  const expires = invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "no expiry";
  return (
    <View style={styles.inviteRow} testID={`settings-invite-${invite.id}`}>
      <View style={styles.memberInfo}>
        <Text variant="body" numberOfLines={1}>
          Invite — expires {expires}
        </Text>
        <Text variant="caption" tone="muted">
          Created {new Date(invite.createdAt).toLocaleDateString()}
        </Text>
      </View>
      <Button
        testID={`settings-revoke-${invite.id}`}
        label="Revoke"
        variant="secondary"
        size="md"
        disabled={busy}
        onPress={onRevoke}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
  },
  headerSpacer: { width: 40 },
  closeGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  card: { gap: tokens.space.md },
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
  colorRow: { flexDirection: "row", gap: tokens.space.md },
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
  coverPreviewEmoji: { fontSize: 28 },
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
  memberInfo: { flex: 1, gap: 2 },
  inviteList: { gap: tokens.space.sm },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.space.sm,
    gap: tokens.space.md,
    borderTopWidth: 1,
    borderTopColor: tokens.border.subtle,
    paddingTop: tokens.space.sm,
  },
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
  moduleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  moduleRowOn: { backgroundColor: tokens.accent.muted },
  moduleRowPressed: { opacity: 0.7 },
  moduleText: { flex: 1, gap: 2 },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: tokens.accent.default },
  toggleOff: { backgroundColor: tokens.border.subtle },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  toggleKnobOn: { transform: [{ translateX: 16 }] },
  warningBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
});
