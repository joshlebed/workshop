// Games-home card for the newest inbound friend request (onboarding spike #7,
// rules in ../lib/friendRequestCard.ts): "Sam wants to be friends" with
// Accept / Decline inline. The X only hides the card for this request
// (`friends.request-card` user flag); decline stays an explicit button.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { FriendRequestSummary } from "@workshop/shared/friends";
import type { UserFlagsResponse } from "@workshop/shared/games";
import { type Href, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { fetchUserFlags, putUserFlag } from "../../api/release";
import { Avatar, Button, IconButton, PixelIcon, Text, tokens } from "../../theme";
import { useFriendRequestAnswers } from "../hooks/useFriendRequestAnswers";
import { useOpenProfile } from "../hooks/useOpenProfile";
import {
  dismissedRequestCardValue,
  friendRequestCardCopy,
  friendRequestCardTarget,
} from "../lib/friendRequestCard";
import { useGamesRuntime } from "../runtime";

export function FriendRequestCard() {
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const livePoll = useLivePollingInterval();
  const openProfile = useOpenProfile();
  const { accept, decline, answeringIds } = useFriendRequestAnswers();

  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const flagsQuery = useQuery({
    queryKey: queryKeys.users.flags,
    queryFn: () => fetchUserFlags(token),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: (request: FriendRequestSummary) =>
      putUserFlag(
        token,
        USER_FLAG_KEYS.friendRequestCard,
        dismissedRequestCardValue(request, new Date()),
      ),
    // Optimistic: a failed write only brings the card back on the next fetch.
    onMutate: (request) => {
      queryClient.setQueryData<UserFlagsResponse>(queryKeys.users.flags, (prev) => ({
        flags: {
          ...(prev?.flags ?? {}),
          [USER_FLAG_KEYS.friendRequestCard]: dismissedRequestCardValue(request, new Date()),
        },
      }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.flags }),
  });

  // Hidden until flags load, so a dismissed card never flashes.
  if (!requestsQuery.data || !flagsQuery.data) return null;
  const inbound = requestsQuery.data.inbound;
  const request = friendRequestCardTarget(
    inbound,
    flagsQuery.data.flags[USER_FLAG_KEYS.friendRequestCard],
  );
  if (!request) return null;
  const { title, detail } = friendRequestCardCopy(request, inbound.length);
  const answering = answeringIds.includes(request.userId);

  return (
    <View style={styles.card} testID="friend-request-card" accessibilityRole="summary">
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${request.displayName?.trim() || "their"} profile`}
          onPress={() => openProfile(request.userId)}
          style={styles.who}
          testID="friend-request-card-profile"
        >
          <Avatar
            name={request.displayName}
            imageUrl={userAvatarImageUrl(request.userId)}
            size="md"
          />
          <View style={styles.copy}>
            <Text variant="label" numberOfLines={2}>
              {title}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {detail}
            </Text>
          </View>
        </Pressable>
        <IconButton
          accessibilityLabel="Hide this request card"
          onPress={() => dismissMutation.mutate(request)}
          testID="friend-request-card-dismiss"
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <View style={styles.actions}>
        {answering ? (
          <ActivityIndicator size="small" color={tokens.accent.default} />
        ) : (
          <>
            <Button
              label="Accept"
              onPress={() => accept(request.userId)}
              style={styles.action}
              testID="friend-request-card-accept"
            />
            <Button
              label="Decline"
              variant="secondary"
              onPress={() => decline(request.userId)}
              style={styles.action}
              testID="friend-request-card-decline"
            />
            {inbound.length > 1 ? (
              <Button
                label="See all"
                variant="ghost"
                onPress={() => router.push(routes.friends as Href)}
                testID="friend-request-card-all"
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.sm,
    marginHorizontal: tokens.space.lg,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.accent.default,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  top: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  who: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, minHeight: 40 },
  action: { flex: 1 },
});
