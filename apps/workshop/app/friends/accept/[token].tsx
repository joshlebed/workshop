import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { acceptFriendRequest, fetchFriendRequestPreview } from "../../../src/api/friends";
import { useAuth } from "../../../src/hooks/useAuth";
import { errorMessage } from "../../../src/lib/api";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";
import { haptics } from "../../../src/lib/haptics";
import { PENDING_FRIEND_INVITE_TOKEN_KEY } from "../../../src/lib/inviteStash";
import { queryKeys } from "../../../src/lib/queryKeys";
import { removeItem, setItem } from "../../../src/lib/storage";
import { Avatar, Button, Card, Text, tokens } from "../../../src/ui/index";

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
 *      clear the stash, refresh the friend + games caches, and go to /friends.
 */
export default function AcceptFriendInvite() {
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Stash on mount so a redirect through /sign-in can recover the token. Gated
  // on the flag so a stale link can never strand a prod (flag-off) user.
  useEffect(() => {
    if (!GAMES_TAB_ENABLED || !inviteToken) return;
    setItem(PENDING_FRIEND_INVITE_TOKEN_KEY, inviteToken).catch(() => {});
  }, [inviteToken]);

  // Signed-out → send through sign-in. AuthGate bounces back here once signed
  // in (it consults the friend stash, same as the list-invite stash).
  useEffect(() => {
    if (!GAMES_TAB_ENABLED) return;
    if (status === "signed-out" && inviteToken) {
      router.replace("/sign-in");
    }
  }, [status, inviteToken, router]);

  const previewQuery = useQuery({
    queryKey: queryKeys.friends.requestPreview(inviteToken ?? ""),
    queryFn: () => fetchFriendRequestPreview(inviteToken ?? "", authToken),
    enabled: GAMES_TAB_ENABLED && !!inviteToken && status === "signed-in",
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequest(inviteToken ?? "", authToken),
    onSuccess: async () => {
      haptics.medium();
      await removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        // Friendship gates score visibility — refresh the social board.
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      router.replace("/friends");
    },
    onError: (e) => {
      // Drop the stash on a hard failure so re-opening doesn't loop back here.
      removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      setError(errorMessage(e, "Couldn't accept the invite"));
    },
  });

  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }

  if (!inviteToken) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite link missing token</Text>
          <Text tone="secondary">Ask your friend to send you a fresh invite link.</Text>
          <Button label="Go home" onPress={() => router.replace("/")} testID="friend-accept-home" />
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
          <Button label="Go home" onPress={() => router.replace("/")} testID="friend-accept-home" />
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
          <Button label="Go home" onPress={() => router.replace("/")} testID="friend-accept-home" />
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
            onPress={() => router.replace("/friends")}
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
          <Avatar name={preview.inviter.displayName} size="lg" testID="friend-accept-avatar" />
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
            router.replace("/");
          }}
          disabled={acceptMutation.isPending}
          testID="friend-accept-decline"
        />
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
});
