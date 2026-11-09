// Shared tail of both link flows — friend invite (`/friends/accept/:token`)
// and play link (`/g/:token`): once the friendship exists, pick which of the
// new friend's games to add. One component so the two links converge on the
// same onboarding; the screens own only their own preview + accept step.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { DiscoveryGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../../theme";
import { addGame, fetchGameDiscovery } from "../../api/games";
import { useOpenProfile } from "../../hooks/useOpenProfile";
import { localDateKey } from "../../lib/gameDate";
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
  const queryClient = useQueryClient();
  const openProfile = useOpenProfile();
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
});
