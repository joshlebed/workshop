import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlbumShelfListMetadata,
  Invite,
  ListColor,
  ListMemberSummary,
  PendingInvite,
} from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { refreshAlbumShelf } from "../../../src/api/albumShelf";
import { createInvite, revokeInvite } from "../../../src/api/invites";
import { deleteList, fetchListDetail, updateList } from "../../../src/api/lists";
import { removeMember } from "../../../src/api/members";
import { useAuth } from "../../../src/hooks/useAuth";
import { ApiError } from "../../../src/lib/api";
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

const EMOJI_CHOICES = ["🎬", "📺", "📚", "💡", "✈️", "🍿", "🎮", "🎵", "🍔", "🌅", "🏔️", "🎨"];

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
  const isOwner = !!list && !!user && list.ownerId === user.id;

  // Tokens are only returned on the POST response — keep the most-recent
  // freshly-generated invite in component state so the owner can copy/share
  // its URL. Pending invites loaded from `GET /v1/lists/:id` never include
  // the token (security per 3a-1), so refresh-and-recover is "revoke and
  // regenerate".
  const [freshInvite, setFreshInvite] = useState<FreshInvite | null>(null);

  // Details form (owner-only). Initialized lazily once the list loads.
  const [name, setName] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [color, setColor] = useState<ListColor | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  // Hydrate form state once on first list load.
  if (list && name === null && emoji === null && color === null && description === null) {
    setName(list.name);
    setEmoji(list.emoji);
    setColor(list.color);
    setDescription(list.description ?? "");
  }

  const detailsDirty = useMemo(() => {
    if (!list || name === null || emoji === null || color === null || description === null) {
      return false;
    }
    const desc = description.trim();
    const currentDesc = list.description ?? "";
    return (
      name.trim() !== list.name ||
      emoji !== list.emoji ||
      color !== list.color ||
      desc !== currentDesc
    );
  }, [list, name, emoji, color, description]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!id || name === null || emoji === null || color === null || description === null) {
        throw new Error("invalid form state");
      }
      const desc = description.trim();
      return updateList(
        id,
        {
          name: name.trim(),
          emoji,
          color,
          description: desc.length > 0 ? desc : null,
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
        message: e instanceof ApiError ? e.message : "Couldn't save list",
        tone: "danger",
      });
    },
  });

  const generateInviteMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return createInvite(id, {}, token);
    },
    onSuccess: async (res) => {
      // The POST response is the only place the token is returned.
      const fresh = res.invite;
      if (!fresh.token) {
        showToast({
          message: "Invite created but token missing — revoke and retry.",
          tone: "danger",
        });
        return;
      }
      setFreshInvite({ ...fresh, token: fresh.token });
      if (id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      }
      const url = buildInviteShareUrl(fresh.token);
      const ok = await copyToClipboard(url);
      showToast({
        message: ok ? "Share link copied to clipboard" : "Share link generated",
        tone: ok ? "success" : "default",
      });
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't generate invite",
        tone: "danger",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => {
      if (!id) throw new Error("missing list id");
      return revokeInvite(id, inviteId, token);
    },
    onSuccess: async (_res, inviteId) => {
      // Drop the cached fresh invite if its id matches the revoked one.
      setFreshInvite((prev) => (prev && prev.id === inviteId ? null : prev));
      if (id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      }
      showToast({ message: "Share link revoked", tone: "default" });
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't revoke invite",
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
      if (id) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      if (isSelfLeave) {
        // Self-leave navigates back to the home list — they no longer have
        // access to the list detail screen.
        router.replace("/");
      } else {
        showToast({ message: "Member removed", tone: "default" });
      }
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't remove member",
        tone: "danger",
      });
    },
  });

  // --- Album Shelf source playlist (any member can change URL) ---

  const albumShelfMeta =
    list?.type === "album_shelf" ? (list.metadata as Partial<AlbumShelfListMetadata>) : null;
  const [shelfUrl, setShelfUrl] = useState<string | null>(null);
  if (albumShelfMeta && shelfUrl === null) {
    setShelfUrl(albumShelfMeta.spotifyPlaylistUrl ?? "");
  }

  const updateSourceMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return updateList(id, { metadata: { spotifyPlaylistUrl: (shelfUrl ?? "").trim() } }, token);
    },
    onSuccess: async () => {
      if (!id) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.albumShelf.items(id) }),
      ]);
      showToast({ message: "Source updated and refreshed.", tone: "success" });
    },
    onError: (e) => {
      const code =
        e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : undefined;
      const message =
        code === "INVALID_PLAYLIST_URL"
          ? "That doesn't look like a Spotify playlist URL."
          : code === "PLAYLIST_NOT_AVAILABLE"
            ? "We couldn't read that playlist. Make sure it's public."
            : code === "SPOTIFY_UNAVAILABLE"
              ? "Spotify is having a moment. Try again."
              : e instanceof Error
                ? e.message
                : "Couldn't update source.";
      showToast({ message, tone: "danger" });
    },
  });

  const refreshShelfMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return refreshAlbumShelf(id, token);
    },
    onSuccess: async (res) => {
      if (!id) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.albumShelf.items(id) }),
      ]);
      showToast({
        message:
          res.addedCount === 0
            ? "No new albums detected."
            : `Detected ${res.addedCount} new album${res.addedCount === 1 ? "" : "s"}.`,
        tone: res.addedCount === 0 ? "default" : "success",
      });
    },
    onError: (e) => {
      showToast({
        message: e instanceof Error ? e.message : "Couldn't refresh.",
        tone: "danger",
      });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("missing list id");
      return deleteList(id, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace("/");
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't delete list",
        tone: "danger",
      });
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
          onPress={() => router.back()}
          testID="settings-close"
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </IconButton>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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

        {/* --- Album Shelf source playlist (any member) --- */}
        {list?.type === "album_shelf" && albumShelfMeta ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="secondary">
              Source playlist
            </Text>
            {albumShelfMeta.spotifyPlaylistUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  if (albumShelfMeta.spotifyPlaylistUrl) {
                    Linking.openURL(albumShelfMeta.spotifyPlaylistUrl).catch(() => {});
                  }
                }}
                testID="settings-source-open"
              >
                <Text style={styles.urlText} numberOfLines={1}>
                  {albumShelfMeta.spotifyPlaylistUrl}
                </Text>
              </Pressable>
            ) : null}
            <Text variant="caption" tone="muted">
              {albumShelfMeta.lastRefreshedAt
                ? `Last refreshed ${formatRelative(albumShelfMeta.lastRefreshedAt)}${
                    albumShelfMeta.lastRefreshedBy
                      ? (
                          () => {
                            const name = members.find(
                              (m) => m.userId === albumShelfMeta.lastRefreshedBy,
                            )?.displayName;
                            return name ? ` by @${name}` : "";
                          }
                        )()
                      : ""
                  }`
                : "Not yet refreshed."}
            </Text>
            <View style={styles.field}>
              <Text variant="caption" tone="muted">
                Change source URL
              </Text>
              <TextInput
                testID="settings-source-url"
                value={shelfUrl ?? ""}
                onChangeText={setShelfUrl}
                placeholder="https://open.spotify.com/playlist/…"
                placeholderTextColor={tokens.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={2048}
                style={styles.input}
              />
              <Button
                testID="settings-source-save"
                label="Save and refresh"
                size="md"
                disabled={
                  updateSourceMutation.isPending ||
                  refreshShelfMutation.isPending ||
                  (shelfUrl ?? "").trim() === (albumShelfMeta.spotifyPlaylistUrl ?? "")
                }
                loading={updateSourceMutation.isPending}
                onPress={() => updateSourceMutation.mutate()}
              />
            </View>
            <Button
              testID="settings-refresh-now"
              label="Refresh now"
              variant="secondary"
              size="md"
              loading={refreshShelfMutation.isPending}
              disabled={refreshShelfMutation.isPending || updateSourceMutation.isPending}
              onPress={() => refreshShelfMutation.mutate()}
            />
          </Card>
        ) : null}

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

        {/* --- Danger zone --- */}
        {isOwner ? (
          <Card style={styles.card} elevated>
            <Text variant="label" tone="danger">
              Danger zone
            </Text>
            <Text tone="secondary">
              Delete this list and all of its items. This cannot be undone.
            </Text>
            <Button
              testID="settings-delete-list"
              label="Delete list"
              variant="danger"
              size="md"
              loading={deleteListMutation.isPending}
              disabled={deleteListMutation.isPending}
              onPress={() => deleteListMutation.mutate()}
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
      </ScrollView>
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
  // Owner can remove anyone except themselves; non-owners can self-leave but
  // the list-level "Leave list" button below the members list is the canonical
  // path — keep this row read-only for non-owners to avoid a duplicate gesture.
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
});
