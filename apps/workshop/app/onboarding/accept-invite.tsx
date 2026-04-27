import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { acceptInvite } from "../../src/api/invites";
import { useAuth } from "../../src/hooks/useAuth";
import { ApiError } from "../../src/lib/api";
import { PENDING_INVITE_TOKEN_KEY } from "../../src/lib/inviteStash";
import { queryKeys } from "../../src/lib/queryKeys";
import { removeItem, setItem } from "../../src/lib/storage";
import { Button, Card, Text, tokens } from "../../src/ui/index";

/**
 * Deep-link landing screen for `/invite/:token` and `workshop://invite/:token`.
 *
 * Flow:
 *  1. Stash the invite token in storage so a sign-in round-trip can recover it.
 *  2. If signed-out → AuthGate routes the user to `/sign-in`. After sign-in
 *     the gate consults the stashed token (see `_layout.tsx`) and bounces
 *     them right back here.
 *  3. If signed-in (or just-signed-in) → POST `/v1/invites/:token/accept`,
 *     clear the stash, and navigate to the joined list.
 */
export default function AcceptInvite() {
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const acceptedRef = useRef(false);

  // Stash on mount so a redirect through /sign-in can recover the token.
  useEffect(() => {
    if (!inviteToken) return;
    setItem(PENDING_INVITE_TOKEN_KEY, inviteToken).catch(() => {});
  }, [inviteToken]);

  // If the user isn't signed in yet, send them through the sign-in flow.
  // The stash above guarantees the token survives the round-trip; AuthGate
  // bounces them back to this screen once `status === "signed-in"`.
  useEffect(() => {
    if (status === "signed-out" && inviteToken) {
      router.replace("/sign-in");
    }
  }, [status, inviteToken, router]);

  // When signed-in, accept the invite and route to the list.
  useEffect(() => {
    if (status !== "signed-in" || !authToken || !inviteToken) return;
    if (acceptedRef.current) return;
    acceptedRef.current = true;

    (async () => {
      try {
        const res = await acceptInvite(inviteToken, authToken);
        await removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
        await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
        router.replace(`/list/${res.list.id}`);
      } catch (e) {
        // Drop the stash on a hard failure so re-opening the app doesn't loop
        // back to the broken invite.
        await removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
        setError(
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "couldn't accept invite",
        );
      }
    })();
  }, [status, authToken, inviteToken, router, queryClient]);

  if (!inviteToken) {
    return (
      <View style={styles.center}>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite link missing token</Text>
          <Text tone="secondary">Ask the list owner to send you a fresh share link.</Text>
          <Button label="Go home" onPress={() => router.replace("/")} testID="accept-go-home" />
        </Card>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Card style={styles.card} elevated>
          <Text variant="title">Couldn't join the list</Text>
          <Text tone="secondary" testID="accept-error">
            {error}
          </Text>
          <Button label="Go home" onPress={() => router.replace("/")} testID="accept-go-home" />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.center} testID="accept-invite-loading">
      <ActivityIndicator color={tokens.accent.default} />
      <Text tone="secondary" style={styles.loadingText}>
        {status === "signed-in" ? "Joining list…" : "Sign in to accept the invite"}
      </Text>
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
  loadingText: { textAlign: "center" },
});
