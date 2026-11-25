// Deep-link landing for a crew link (`/crew/:token`, spike #8).
//
//   1. Stash the token so a sign-in round trip recovers it (AuthGate reads
//      `PENDING_CREW_TOKEN_KEY` after sign-in, and lets `/crew/*` render
//      signed out).
//   2. Signed out → a context card from the public preview (crew name, who
//      started it, who's in it) with "Sign in to join" — not a bare sign-in
//      wall.
//   3. Signed in → the same card with "Join"; `POST /v1/crews/:token/join`
//      makes the viewer friends with every member (the server skips a blocked
//      pair), then `CrewGamesPicker` offers the crew's games and hands off to
//      the crew screen.
//   An existing member goes straight to the crew screen.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { fetchCrewPreview, joinCrew } from "@workshop/api-client/crews";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import type { JoinCrewResponse } from "@workshop/shared/crews";
import { haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button, Card, scoreType, Text, tokens } from "../../theme";
import { OpenInAppCard } from "../components/OpenInAppCard";
import { useInAppBrowserPrompt } from "../hooks/useInAppBrowserPrompt";
import { crewKicker, memberNamesLine } from "../lib/crews";
import { PENDING_CREW_TOKEN_KEY } from "../lib/inviteStash";
import { useGamesRuntime } from "../runtime";
import { Centered, CrewGamesPicker, styles as pickerStyles } from "./friendAccept/PostAcceptPicker";

export default function CrewJoin() {
  const params = useLocalSearchParams<{ token?: string }>();
  const crewToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, routes, appName, appScheme } = useGamesRuntime();
  const { showAppPrompt, continueOnWeb } = useInAppBrowserPrompt(
    crewToken ? `/crew/${encodeURIComponent(crewToken)}` : null,
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const [joined, setJoined] = useState<JoinCrewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!crewToken) return;
    setItem(PENDING_CREW_TOKEN_KEY, crewToken).catch(() => {});
  }, [crewToken]);

  const signedIn = status === "signed-in";
  const previewQuery = useQuery({
    // The signed-in preview carries `viewer`; key it apart from the anonymous one.
    queryKey: [...queryKeys.crews.preview(crewToken ?? ""), signedIn ? "viewer" : "anon"],
    queryFn: () => fetchCrewPreview(crewToken ?? "", signedIn ? authToken : null),
    enabled: !!crewToken && !showAppPrompt && !joined && (status === "signed-out" || signedIn),
  });

  const joinMutation = useMutation({
    mutationFn: () => joinCrew(crewToken ?? "", authToken),
    onSuccess: async (data) => {
      haptics.medium();
      await removeItem(PENDING_CREW_TOKEN_KEY).catch(() => {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.crews.mine }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        // Friendship gates score visibility — refresh the boards.
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      setJoined(data);
    },
    onError: (e) => {
      removeItem(PENDING_CREW_TOKEN_KEY).catch(() => {});
      setError(errorMessage(e, "Couldn't join the crew"));
    },
  });

  // Already in it: nothing to join, open the crew.
  const isMember = previewQuery.data?.viewer?.isMember === true;
  const crewId = previewQuery.data?.crew.id;
  useEffect(() => {
    if (!isMember || !crewId || joined) return;
    removeItem(PENDING_CREW_TOKEN_KEY).catch(() => {});
    router.replace(routes.crew(crewId) as Href);
  }, [isMember, crewId, joined, router, routes]);

  if (showAppPrompt) {
    return (
      <Centered testID="crew-join-open-in-app">
        <OpenInAppCard
          appName={appName}
          url={`${appScheme}:///crew/${encodeURIComponent(crewToken ?? "")}`}
          onContinue={continueOnWeb}
        />
      </Centered>
    );
  }

  const home = () => router.replace(routes.root as Href);

  if (!crewToken || error || previewQuery.isError) {
    return (
      <Centered>
        <Card style={pickerStyles.card} elevated>
          <Text variant="title">{error ? "Couldn't join" : "Crew not found"}</Text>
          <Text tone="secondary" testID="crew-join-error">
            {error ?? "This crew link isn't valid anymore. Ask for a fresh one."}
          </Text>
          <Button label="Go home" onPress={home} testID="crew-join-home" />
        </Card>
      </Centered>
    );
  }

  if (joined) {
    return (
      <CrewGamesPicker
        crewName={joined.crew.name}
        members={joined.friends}
        token={authToken}
        onDone={() => router.replace(routes.crew(joined.crew.id) as Href)}
      />
    );
  }

  const preview = previewQuery.data;
  if (!preview || isMember) {
    return (
      <Centered testID="crew-join-loading">
        <ActivityIndicator color={tokens.accent.default} />
      </Centered>
    );
  }

  const { crew } = preview;
  const full = crew.memberCount >= crew.maxMembers;
  const names = memberNamesLine(crew.memberFirstNames, crew.memberCount);
  const others = crew.memberCount;

  return (
    <Centered testID="crew-join">
      <Card style={pickerStyles.card} elevated>
        <View style={pickerStyles.inviterBlock}>
          <Text variant="overline" tone="secondary" testID="crew-join-kicker">
            Join {crewKicker(preview)}
          </Text>
          <Text variant="title" style={pickerStyles.inviterTitle} testID="crew-join-name">
            {crew.name}
          </Text>
          <View style={local.countRow}>
            <Text style={local.count}>{others}</Text>
            <Text tone="secondary">{others === 1 ? "member" : "members"}</Text>
          </View>
          {names ? (
            <Text tone="secondary" style={pickerStyles.inviterCaption} testID="crew-join-names">
              {names}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={pickerStyles.inviterCaption}>
            Everyone in a crew is friends with everyone in it.{" "}
            {others === 1
              ? "Join to compare daily game scores with them."
              : `Join to compare daily game scores with all ${others} of them.`}
          </Text>
        </View>
        {full ? (
          <Text tone="secondary" style={pickerStyles.inviterCaption} testID="crew-join-full">
            This crew is full ({crew.maxMembers} people).
          </Text>
        ) : signedIn ? (
          <Button
            label={`Join ${crew.name}`}
            onPress={() => joinMutation.mutate()}
            loading={joinMutation.isPending}
            disabled={joinMutation.isPending}
            testID="crew-join-button"
          />
        ) : (
          <Button
            label="Sign in to join"
            onPress={() => router.push(routes.signIn as Href)}
            testID="crew-join-sign-in"
          />
        )}
        <Button
          label="Not now"
          variant="ghost"
          onPress={() => {
            removeItem(PENDING_CREW_TOKEN_KEY).catch(() => {});
            home();
          }}
          disabled={joinMutation.isPending}
          testID="crew-join-decline"
        />
      </Card>
    </Centered>
  );
}

const local = StyleSheet.create({
  countRow: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  count: { ...scoreType(20), color: tokens.neon.pink },
});
