// Shared tail of both link flows — friend invite (`/friends/accept/:token`)
// and play link (`/g/:token`). Once the friendship exists:
//   1. People you both know — the new friend's friends you aren't connected
//      to yet (`GET /v1/friends/mutuals`, filtered to those this friend
//      vouches for), one-tap Add = a directed request. Skipped when empty.
//   2. Games — ranked across the new friend plus everyone just requested
//      (`GET /v1/games/discovery?users=…`), one-tap add / Add all.
// One component so the two links converge on the same onboarding; the
// screens own only their own preview + accept step.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchMutuals, sendFriendRequest } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { MutualSummary } from "@workshop/shared/friends";
import type { DiscoveryGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../../theme";
import { addGame, fetchGameDiscovery } from "../../api/games";
import { useOpenProfile } from "../../hooks/useOpenProfile";
import { localDateKey } from "../../lib/gameDate";
import { mutualsVia } from "../../lib/mutualsVia";
import { FriendGameSuggestions } from "../games/FriendGameSuggestions";

/**
 * Post-accept game picker (G3) — the new friend's games you don't already have,
 * each one-tap addable plus an "Add all". Skippable via "Done"; either way we
 * land on the Games home so a brand-new user leaves onboarding with content.
 */
export function PostAcceptPicker({
  friend,
  token,
  onDone,
}: {
  friend: { userId: string; displayName: string | null };
  token: string | null;
  onDone: () => void;
}) {
  const name = friend.displayName?.trim() || "Your friend";
  const [step, setStep] = useState<"people" | "games">("people");
  // Mutuals requested in this session — they join the games ranking below.
  const [requested, setRequested] = useState<string[]>([]);

  // The friendship just formed, so the mutuals feed is this friend's circle
  // (plus any older friends' circles, which `mutualsVia` filters out).
  const mutualsQuery = useQuery({
    queryKey: queryKeys.friends.mutuals,
    queryFn: () => fetchMutuals(token),
    enabled: step === "people",
    staleTime: 0,
  });
  const people = mutualsQuery.data ? mutualsVia(mutualsQuery.data.mutuals, friend.userId) : null;

  if (step === "people") {
    if (mutualsQuery.isLoading) {
      return (
        <Centered testID="friend-accept-loading">
          <ActivityIndicator color={tokens.accent.default} />
        </Centered>
      );
    }
    // Nothing to offer (or the feed failed) → straight to games.
    if (!people || people.length === 0) {
      return <GamesStep friend={friend} name={name} token={token} requested={[]} onDone={onDone} />;
    }
    return (
      <PeopleStep
        friend={friend}
        name={name}
        people={people}
        token={token}
        requested={requested}
        onRequested={(id) => setRequested((ids) => (ids.includes(id) ? ids : [...ids, id]))}
        onContinue={() => setStep("games")}
      />
    );
  }

  return (
    <GamesStep friend={friend} name={name} token={token} requested={requested} onDone={onDone} />
  );
}

/**
 * Step 1 — the new friend's friends you don't know yet. Each Add sends a
 * directed request (they still have to accept); the row flips to "Requested".
 */
function PeopleStep({
  friend,
  name,
  people,
  token,
  requested,
  onRequested,
  onContinue,
}: {
  friend: { userId: string; displayName: string | null };
  name: string;
  people: MutualSummary[];
  token: string | null;
  requested: string[];
  onRequested: (userId: string) => void;
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  const openProfile = useOpenProfile();
  const [requesting, setRequesting] = useState<string[]>([]);

  const request = useMutation({
    mutationFn: (userId: string) => sendFriendRequest(userId, token),
    onMutate: (userId) => setRequesting((ids) => [...ids, userId]),
    onSuccess: async (_data, userId) => {
      haptics.medium();
      onRequested(userId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
    },
    onSettled: (_d, _e, userId) => setRequesting((ids) => ids.filter((id) => id !== userId)),
  });

  const requestedAny = requested.length > 0;
  return (
    <Centered testID="friend-accept-people">
      <Card style={styles.card} elevated>
        <View style={styles.inviterBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${name}'s profile`}
            onPress={() => openProfile(friend.userId)}
            style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
            testID="friend-accept-friend"
          >
            <Avatar
              name={friend.displayName}
              imageUrl={userAvatarImageUrl(friend.userId)}
              size="lg"
            />
            <Text variant="title" style={styles.inviterTitle}>
              You're friends with {name}
            </Text>
          </Pressable>
          <Text tone="secondary" style={styles.inviterCaption}>
            People you both know — add anyone you play with.
          </Text>
        </View>

        <ScrollView
          style={styles.pickerScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.peopleList}>
            {people.map((person) => {
              const personName = person.displayName?.trim() || "Someone";
              const isRequested = requested.includes(person.userId);
              const busy = requesting.includes(person.userId);
              const others = person.mutualFriends.filter((f) => f.userId !== friend.userId);
              const line =
                others.length === 0
                  ? `Friends with ${name}`
                  : `Friends with ${name} and ${others.length} more you know`;
              return (
                <View
                  key={person.userId}
                  style={styles.personRow}
                  testID={`friend-accept-person-${person.userId}`}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${personName}'s profile`}
                    onPress={() => openProfile(person.userId)}
                    style={styles.personIdentity}
                  >
                    <Avatar
                      name={person.displayName}
                      imageUrl={userAvatarImageUrl(person.userId)}
                      size="md"
                    />
                    <View style={styles.personText}>
                      <Text variant="label" numberOfLines={1}>
                        {personName}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {line}
                      </Text>
                    </View>
                  </Pressable>
                  {isRequested ? (
                    <View
                      style={styles.requestedPill}
                      testID={`friend-accept-requested-${person.userId}`}
                    >
                      <Text variant="label" style={styles.requestedText}>
                        Requested
                      </Text>
                    </View>
                  ) : (
                    <Button
                      label="Add"
                      variant="secondary"
                      size="md"
                      loading={busy}
                      disabled={busy}
                      onPress={() => request.mutate(person.userId)}
                      testID={`friend-accept-person-add-${person.userId}`}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>

        <Button
          label={requestedAny ? "Continue" : "Skip for now"}
          onPress={onContinue}
          testID="friend-accept-people-continue"
        />
      </Card>
    </Centered>
  );
}

/**
 * Step 2 — games to add, ranked across the new friend and everyone just
 * requested. Skippable via "Done"; either way we land on the Games home so a
 * brand-new user leaves onboarding with content.
 */
function GamesStep({
  friend,
  name,
  token,
  requested,
  onDone,
}: {
  friend: { userId: string; displayName: string | null };
  name: string;
  token: string | null;
  requested: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const openProfile = useOpenProfile();
  const [adding, setAdding] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const across = requested.length > 0;
  const userIds = [friend.userId, ...requested];

  const discoveryQuery = useQuery({
    queryKey: across
      ? queryKeys.games.discoveryAcross(userIds)
      : queryKeys.games.discovery(friend.userId),
    queryFn: () =>
      fetchGameDiscovery(token, across ? { userIds } : { friendUserId: friend.userId }),
    enabled: !!friend.userId,
  });
  const games = discoveryQuery.data?.games ?? [];
  // `games` is the friend's games you DON'T already have, so an empty list has
  // two very different meanings. `friendGameCount` (friend's total) tells them
  // apart: 0 → they genuinely have no games; >0 → you already have them all.
  // (Only the single-friend form reports it; across people we never explain.)
  const friendHasGames = across || (discoveryQuery.data?.friendGameCount ?? 0) > 0;

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${name}'s profile`}
            onPress={() => openProfile(friend.userId)}
            style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
            testID="friend-accept-friend"
          >
            <Avatar
              name={friend.displayName}
              imageUrl={userAvatarImageUrl(friend.userId)}
              size="lg"
            />
            <Text variant="title" style={styles.inviterTitle}>
              {across ? "Pick your first games" : `You're friends with ${name}`}
            </Text>
          </Pressable>
        </View>

        {discoveryQuery.isLoading ? (
          <View style={styles.pickerLoading}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : games.length > 0 ? (
          <>
            <Text tone="secondary" style={styles.inviterCaption}>
              {across
                ? `What ${name} and the people you added play — add any to your home.`
                : `${name} plays these — add any to your home.`}
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
                hideFriendLine={!across}
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

export function Centered({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
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
  identity: { alignItems: "center", gap: tokens.space.sm },
  identityPressed: { opacity: 0.6 },
  inviterTitle: { textAlign: "center" },
  inviterCaption: { textAlign: "center" },
  loadingText: { textAlign: "center" },
  pickerLoading: { paddingVertical: tokens.space.lg, alignItems: "center" },
  pickerScroll: { maxHeight: 280, alignSelf: "stretch" },
  peopleList: { gap: tokens.space.sm },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
  personIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  personText: { flex: 1, minWidth: 0 },
  requestedPill: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  requestedText: { color: tokens.text.secondary },
});
