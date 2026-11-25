import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { sendFriendRequest } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import type { GameChallengePreview } from "@workshop/shared/games";
import { haptics, openExternalUrl } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../theme";
import { acceptGameChallenge, addGame, fetchGameChallenge } from "../api/games";
import { OpenInAppCard } from "../components/OpenInAppCard";
import { useChallengeFriend } from "../hooks/useChallengeFriend";
import { useInAppBrowserPrompt } from "../hooks/useInAppBrowserPrompt";
import { challengeTimeLeft } from "../lib/challenge";
import { localDateKey } from "../lib/gameDate";
import { PENDING_CHALLENGE_TOKEN_KEY } from "../lib/inviteStash";
import { useGamesRuntime } from "../runtime";
import { styles as acceptStyles, Centered } from "./friendAccept/PostAcceptPicker";

/**
 * Landing for a challenge link (`/c/:token`, onboarding spike #2): "Josh
 * challenged you — beat 937 on today's MapTap". The resolve is public, so a
 * signed-out visitor sees the challenge before being asked to sign in (a
 * minimal version of spike #1's pre-sign-in context); the token is stashed so
 * AuthGate brings them back here after sign-in.
 *
 * Signed in: **Accept challenge** forms the friendship (the token vouches it)
 * and adds the game in one call, lands on that game's board for the
 * challenge's day — the challenger's row plus the paste prompt — and opens the
 * game itself so returning to the app finds the board. An expired challenge
 * still shows who and what; accepting is replaced by "add the game anyway"
 * (plus the vouched friend request when not friends yet).
 */
export default function ChallengeLanding() {
  const params = useLocalSearchParams<{ token?: string }>();
  const challengeToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, appName, appScheme, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const challengeFriend = useChallengeFriend();
  const [error, setError] = useState<string | null>(null);

  const { showAppPrompt, continueOnWeb } = useInAppBrowserPrompt(
    challengeToken ? `/c/${encodeURIComponent(challengeToken)}` : null,
  );

  // Stash on mount so the sign-in round trip comes back here.
  useEffect(() => {
    if (!challengeToken) return;
    setItem(PENDING_CHALLENGE_TOKEN_KEY, challengeToken).catch(() => {});
  }, [challengeToken]);

  const signedIn = status === "signed-in";
  const resolveQuery = useQuery({
    queryKey: [...queryKeys.games.challenge(challengeToken ?? ""), signedIn ? "viewer" : "public"],
    queryFn: () => fetchGameChallenge(challengeToken ?? "", signedIn ? authToken : null),
    enabled:
      !!challengeToken && !showAppPrompt && (status === "signed-in" || status === "signed-out"),
    // Drives one-shot actions off the viewer's current relationship.
    staleTime: 0,
    gcTime: 0,
  });

  // Signed in and resolved: the stash has done its job.
  useEffect(() => {
    if (signedIn && resolveQuery.isSuccess) {
      removeItem(PENDING_CHALLENGE_TOKEN_KEY).catch(() => {});
    }
  }, [signedIn, resolveQuery.isSuccess]);

  /** Refresh My Games, land on the board for that day, optionally open the game. */
  const goToBoard = async (
    game: { id: string; url: string },
    periodKey: string,
    openGame: boolean,
  ) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      // `refetchType: "all"`: the board's My Games query isn't mounted yet,
      // and it must already hold the just-added game when the board renders.
      // The challenge resolve itself is left alone: re-resolving would log a
      // second "landing viewed" for the funnel.
      queryClient.invalidateQueries({
        queryKey: ["games"],
        refetchType: "all",
        predicate: (query) => query.queryKey[1] !== "challenge",
      }),
    ]);
    router.replace(routes.game(game.id, periodKey) as Href);
    if (openGame) openExternalUrl(game.url);
  };

  const acceptMutation = useMutation({
    mutationFn: () => acceptGameChallenge(challengeToken ?? "", authToken),
    onSuccess: async (data) => {
      haptics.medium();
      const posted = !!resolveQuery.data?.viewer?.score;
      await goToBoard(data.game, data.periodKey, !posted);
    },
    onError: (e) => {
      // Expired between the resolve and the tap: re-resolve to the "over" card.
      if (e instanceof ApiError && e.status === 410) {
        void resolveQuery.refetch();
        return;
      }
      setError(errorMessage(e, "Couldn't accept the challenge"));
    },
  });

  // "Today's challenge is over — add the game anyway": the game, plus the
  // friendship through the same vouch a play link carries.
  const addAnywayMutation = useMutation({
    mutationFn: async (challenge: GameChallengePreview) => {
      if (!challenge.viewer?.hasGame) await addGame(challenge.game.url, authToken);
      if (!challenge.viewer?.isFriend) {
        await sendFriendRequest(challenge.challenger.userId, authToken, {
          via: challengeToken ?? "",
        });
      }
      return challenge;
    },
    onSuccess: async (challenge) => {
      haptics.medium();
      await goToBoard(challenge.game, localDateKey(), true);
    },
    onError: (e) => setError(errorMessage(e, "Couldn't add the game")),
  });

  if (showAppPrompt) {
    return (
      <Centered testID="challenge-open-in-app">
        <OpenInAppCard
          appName={appName}
          url={`${appScheme}:///c/${encodeURIComponent(challengeToken ?? "")}`}
          onContinue={continueOnWeb}
        />
      </Centered>
    );
  }

  if (!challengeToken || resolveQuery.isError || error) {
    const notFound = !challengeToken || resolveQuery.isError;
    return (
      <Centered>
        <Card style={acceptStyles.card} elevated>
          <Text variant="title">{notFound ? "Challenge not found" : "Something went wrong"}</Text>
          <Text tone="secondary" testID="challenge-error">
            {notFound ? "This link isn't valid anymore." : error}
          </Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="challenge-home"
          />
        </Card>
      </Centered>
    );
  }

  const challenge = resolveQuery.data;
  if (!challenge) {
    return (
      <Centered testID="challenge-loading">
        <ActivityIndicator color={tokens.accent.default} />
      </Centered>
    );
  }

  const name = challenge.challenger.displayName?.trim() || "Someone";
  const firstName = name.split(/\s+/)[0] ?? name;
  const viewer = challenge.viewer;
  const timeLeft = challenge.expired ? null : challengeTimeLeft(challenge.expiresAt);
  const busy = acceptMutation.isPending || addAnywayMutation.isPending;

  const headline = viewer?.isSelf
    ? "Your challenge"
    : challenge.expired
      ? `${firstName}'s challenge is over`
      : `${firstName} challenged you`;
  const caption = viewer?.isSelf
    ? "Send it to someone who thinks they can beat you."
    : challenge.expired
      ? `That day's ${challenge.game.title} is done. Add it and play today's.`
      : `Beat ${challenge.score.display} on today's ${challenge.game.title}.`;

  return (
    <Centered testID="challenge-landing">
      <Card style={acceptStyles.card} elevated>
        <View style={acceptStyles.inviterBlock}>
          <Avatar
            name={challenge.challenger.displayName}
            imageUrl={userAvatarImageUrl(challenge.challenger.userId)}
            size="lg"
          />
          <Text variant="overline" tone="muted">
            Challenge
          </Text>
          <Text variant="title" style={acceptStyles.inviterTitle} testID="challenge-headline">
            {headline}
          </Text>
        </View>

        <View style={styles.scoreBlock}>
          <View style={styles.gameRow}>
            {challenge.game.iconUrl ? (
              <Image source={{ uri: challenge.game.iconUrl }} style={styles.gameIcon} />
            ) : (
              <Text style={styles.gameGlyph}>🎮</Text>
            )}
            <Text variant="game" numberOfLines={1} style={styles.gameTitle}>
              {challenge.game.title}
            </Text>
          </View>
          <Text variant="score" style={styles.score} testID="challenge-score">
            {challenge.score.display}
          </Text>
          <Text variant="caption" tone="secondary">
            {viewer?.isSelf ? "Your score" : `${firstName}'s score`}
            {timeLeft ? ` · ${timeLeft}` : challenge.expired ? " · Over" : ""}
          </Text>
          {viewer?.score && !viewer.isSelf ? (
            <Text variant="caption" tone="secondary" testID="challenge-viewer-score">
              You: {viewer.score.display}
            </Text>
          ) : null}
        </View>

        <Text tone="secondary" style={acceptStyles.inviterCaption}>
          {caption}
        </Text>

        {status === "signed-out" ? (
          <>
            <Button
              label={
                challenge.expired ? `Sign in to play ${challenge.game.title}` : "Sign in to accept"
              }
              onPress={() => router.push(routes.signIn as Href)}
              testID="challenge-sign-in"
            />
            <Text variant="caption" tone="muted" style={acceptStyles.inviterCaption}>
              {`You'll be friends with ${firstName} and ${challenge.game.title} goes in your games.`}
            </Text>
          </>
        ) : viewer?.isSelf ? (
          <>
            {!challenge.expired ? (
              <Button
                label="Share it again"
                onPress={() => void challengeFriend(challenge.game.id, challenge.periodKey)}
                testID="challenge-share-again"
              />
            ) : null}
            <Button
              label="Open the board"
              variant="secondary"
              onPress={() =>
                router.replace(routes.game(challenge.game.id, challenge.periodKey) as Href)
              }
              testID="challenge-open-board"
            />
          </>
        ) : challenge.expired ? (
          <Button
            label={
              viewer?.hasGame && viewer.isFriend
                ? `Play today's ${challenge.game.title}`
                : `Add ${challenge.game.title} anyway`
            }
            onPress={() => addAnywayMutation.mutate(challenge)}
            loading={addAnywayMutation.isPending}
            disabled={busy}
            testID="challenge-add-anyway"
          />
        ) : (
          <Button
            label={viewer?.score ? "See the board" : "Accept challenge"}
            onPress={() => acceptMutation.mutate()}
            loading={acceptMutation.isPending}
            disabled={busy}
            testID="challenge-accept"
          />
        )}
        {status === "signed-in" && !viewer?.isSelf ? (
          <Button
            label="Not now"
            variant="ghost"
            onPress={() => router.replace(routes.root as Href)}
            disabled={busy}
            testID="challenge-decline"
          />
        ) : null}
      </Card>
    </Centered>
  );
}

const styles = StyleSheet.create({
  scoreBlock: {
    alignItems: "center",
    gap: tokens.space.xs,
    paddingVertical: tokens.space.md,
  },
  gameRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, maxWidth: "100%" },
  gameIcon: { width: 24, height: 24, borderRadius: tokens.radius.sm },
  gameGlyph: { fontSize: 20 },
  gameTitle: { flexShrink: 1 },
  score: { fontSize: 40, lineHeight: 52, color: tokens.neon.yellow },
});
