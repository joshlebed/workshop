import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { acceptFriendRequest, fetchFriendRequestPreview } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import type { DiscoveryGame } from "@workshop/shared/games";
import { Avatar, Button, Card, haptics, Text, tokens } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { addGame, fetchGameDiscovery } from "../legacyGames/api/games";
import { localDateKey } from "../legacyGames/lib/gameDate";
import { FriendGameSuggestions } from "../legacyGames/screens/games/FriendGameSuggestions";
import { useClientRuntime } from "../lib/clientRuntime";
import { PENDING_FRIEND_INVITE_TOKEN_KEY } from "../lib/inviteStash";

/**
 * Deep-link landing for a friend invite (`/friends/accept/:token`, minted by
 * `POST /v1/friends/invite`). Mirrors the list invite round-trip
 * (`onboarding/accept-invite.tsx` + `inviteStash`) so a brand-new user can
 * sign in mid-flow and land back here.
 *
 * Unlike the list invite — which auto-accepts on mount — a friend invite
 * previews the inviter and waits for an explicit **Accept** (spec §3.4): you
 * see who's adding you before the edge forms.
 *
 * Flow:
 *   1. Stash the token so a sign-in round-trip recovers it.
 *   2. Signed-out → AuthGate routes to `/sign-in`; the stash bounces the user
 *      back here once signed in.
 *   3. Signed-in → preview the inviter, then on Accept POST the acceptance,
 *      clear the stash, refresh the friend + games caches, and show the
 *      post-accept picker of the new friend's games (G3) — so a brand-new user
 *      leaves onboarding with a populated home.
 */
export default function AcceptFriendInvite() {
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, user, routes } = useClientRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [acceptedFriend, setAcceptedFriend] = useState<{
    userId: string;
    displayName: string | null;
  } | null>(null);

  // Stash on mount so a redirect through /sign-in can recover the token. Gated
  // on the flag so a stale link can never strand a prod (flag-off) user.
  useEffect(() => {
    if (!inviteToken) return;
    setItem(PENDING_FRIEND_INVITE_TOKEN_KEY, inviteToken).catch(() => {});
  }, [inviteToken]);

  // Signed-out → send through sign-in. AuthGate bounces back here once signed
  // in (it consults the friend stash, same as the list-invite stash).
  useEffect(() => {
    if (status === "signed-out" && inviteToken) {
      router.replace(routes.signIn as Href);
    }
  }, [status, inviteToken, router, routes.signIn]);

  const previewQuery = useQuery({
    queryKey: queryKeys.friends.requestPreview(inviteToken ?? ""),
    queryFn: () => fetchFriendRequestPreview(inviteToken ?? "", authToken),
    enabled: !!inviteToken && status === "signed-in" && !acceptedFriend,
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequest(inviteToken ?? "", authToken),
    onSuccess: async (data) => {
      haptics.medium();
      await removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        // Friendship gates score visibility — refresh the social board.
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      // Hand off to the post-accept picker instead of bouncing to /friends.
      setAcceptedFriend(data.friend);
    },
    onError: (e) => {
      // Drop the stash on a hard failure so re-opening doesn't loop back here.
      removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      setError(errorMessage(e, "Couldn't accept the invite"));
    },
  });

  if (!inviteToken) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite link missing token</Text>
          <Text tone="secondary">Ask your friend to send you a fresh invite link.</Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Couldn't add friend</Text>
          <Text tone="secondary" testID="friend-accept-error">
            {error}
          </Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  // Still resolving auth, or signed-out and on the way to /sign-in.
  if (status !== "signed-in") {
    return (
      <Centered testID="friend-accept-loading">
        <ActivityIndicator color={tokens.accent.default} />
        <Text tone="secondary" style={styles.loadingText}>
          Sign in to add your friend
        </Text>
      </Centered>
    );
  }

  // Accepted — pick which of the new friend's games to add (skippable).
  if (acceptedFriend) {
    return (
      <PostAcceptPicker
        friend={acceptedFriend}
        token={authToken}
        onDone={() => router.replace(routes.home as Href)}
      />
    );
  }

  if (previewQuery.isPending) {
    return (
      <Centered testID="friend-accept-loading">
        <ActivityIndicator color={tokens.accent.default} />
      </Centered>
    );
  }

  if (previewQuery.isError) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite not found</Text>
          <Text tone="secondary">This invite link isn't valid anymore.</Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  const preview = previewQuery.data;
  const inviterName = preview.inviter.displayName?.trim() || "Someone";
  const isOwnInvite = preview.inviter.userId === user?.id;

  // You opened your own link — nothing to accept; point you back to Friends.
  if (isOwnInvite) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">This is your invite link</Text>
          <Text tone="secondary">Send it to a friend so they can add you.</Text>
          <Button
            label="Back to Friends"
            onPress={() => router.replace(routes.friends as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  return (
    <Centered testID="friend-accept">
      <Card style={styles.card} elevated>
        <View style={styles.inviterBlock}>
          <Avatar
            name={preview.inviter.displayName}
            imageUrl={userAvatarImageUrl(preview.inviter.userId)}
            size="lg"
            testID="friend-accept-avatar"
          />
          <Text variant="title" style={styles.inviterTitle}>
            {inviterName} wants to be friends
          </Text>
          <Text tone="secondary" style={styles.inviterCaption}>
            Accept to start comparing daily scores. You'll see each other on shared games.
          </Text>
        </View>
        <Button
          label={`Add ${inviterName}`}
          onPress={() => acceptMutation.mutate()}
          loading={acceptMutation.isPending}
          disabled={acceptMutation.isPending}
          testID="friend-accept-button"
        />
        <Button
          label="Not now"
          variant="ghost"
          onPress={() => {
            removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
            router.replace(routes.root as Href);
          }}
          disabled={acceptMutation.isPending}
          testID="friend-accept-decline"
        />
      </Card>
    </Centered>
  );
}

/**
 * Post-accept game picker (G3) — the new friend's games you don't already have,
 * each one-tap addable plus an "Add all". Skippable via "Done"; either way we
 * land on the Games home so a brand-new user leaves onboarding with content.
 */
function PostAcceptPicker({
  friend,
  token,
  onDone,
}: {
  friend: { userId: string; displayName: string | null };
  token: string | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const name = friend.displayName?.trim() || "Your friend";
  const [adding, setAdding] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);

  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(friend.userId),
    queryFn: () => fetchGameDiscovery(token, { friendUserId: friend.userId }),
    enabled: !!friend.userId,
  });
  const games = discoveryQuery.data?.games ?? [];
  // `games` is the friend's games you DON'T already have, so an empty list has
  // two very different meanings. `friendGameCount` (friend's total) tells them
  // apart: 0 → they genuinely have no games; >0 → you already have them all.
  const friendHasGames = (discoveryQuery.data?.friendGameCount ?? 0) > 0;

  // Refresh only the home's My Games — leave this picker's discovery list
  // stable so added rows stay visible (flipped to "✓ Added").
  const invalidateMine = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(localDateKey()) });

  const addOne = useMutation({
    mutationFn: (game: DiscoveryGame) => addGame(game.game.url, token),
    onMutate: (game) => setAdding((ids) => [...ids, game.game.id]),
    onSuccess: async (_data, game) => {
      haptics.medium();
      setAdded((ids) => (ids.includes(game.game.id) ? ids : [...ids, game.game.id]));
      await invalidateMine();
    },
    onSettled: (_data, _e, game) => setAdding((ids) => ids.filter((id) => id !== game.game.id)),
  });

  const addAll = useMutation({
    mutationFn: async () => {
      const toAdd = games.filter((g) => !added.includes(g.game.id));
      setAdding(toAdd.map((g) => g.game.id));
      for (const g of toAdd) {
        await addGame(g.game.url, token);
      }
      return toAdd.map((g) => g.game.id);
    },
    onSuccess: async (ids) => {
      haptics.medium();
      setAdded((prev) => Array.from(new Set([...prev, ...ids])));
      await invalidateMine();
    },
    onSettled: () => setAdding([]),
  });

  const allAdded = games.length > 0 && games.every((g) => added.includes(g.game.id));
  const addedAny = added.length > 0;

  return (
    <Centered testID="friend-accept-picker">
      <Card style={styles.card} elevated>
        <View style={styles.inviterBlock}>
          <Avatar
            name={friend.displayName}
            imageUrl={userAvatarImageUrl(friend.userId)}
            size="lg"
          />
          <Text variant="title" style={styles.inviterTitle}>
            You're friends with {name}
          </Text>
        </View>

        {discoveryQuery.isLoading ? (
          <View style={styles.pickerLoading}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : games.length > 0 ? (
          <>
            <Text tone="secondary" style={styles.inviterCaption}>
              {name} plays these — add any to your home.
            </Text>
            <ScrollView
              style={styles.pickerScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <FriendGameSuggestions
                games={games}
                addingGameIds={adding}
                addedGameIds={added}
                onAdd={(g) => addOne.mutate(g)}
                hideFriendLine
                testIDPrefix="friend-accept-suggestion"
              />
            </ScrollView>
            {allAdded ? null : (
              <Button
                label="Add all"
                variant="secondary"
                onPress={() => addAll.mutate()}
                loading={addAll.isPending}
                testID="friend-accept-add-all"
              />
            )}
          </>
        ) : friendHasGames ? null : ( // have-them-all → nothing looks missing; explaining is noise
          <Text tone="secondary" style={styles.inviterCaption}>
            {name} hasn't added any games yet. Add games anytime from the Games tab.
          </Text>
        )}

        {/* "Maybe later" only makes sense while an offer (suggestions) is on
            screen being declined; with nothing to add the button is pure
            forward navigation, so name the destination. Hidden while discovery
            loads so the label can't flicker between the two meanings. */}
        {discoveryQuery.isLoading ? null : (
          <Button
            label={games.length === 0 ? "Go to Games" : addedAny ? "Done" : "Maybe later"}
            onPress={onDone}
            testID="friend-accept-picker-done"
          />
        )}
      </Card>
    </Centered>
  );
}

function Centered({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  card: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  inviterBlock: { alignItems: "center", gap: tokens.space.sm },
  inviterTitle: { textAlign: "center" },
  inviterCaption: { textAlign: "center" },
  loadingText: { textAlign: "center" },
  pickerLoading: { paddingVertical: tokens.space.lg, alignItems: "center" },
  pickerScroll: { maxHeight: 280, alignSelf: "stretch" },
});
