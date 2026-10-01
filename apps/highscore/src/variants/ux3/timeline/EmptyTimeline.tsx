// The timeline before there is a timeline.
//
// Same spine, same TODAY marker, same grammar — the empty state is the feed
// with nothing in it yet, not a separate illustrated screen. Two variants:
// no friends (invite someone; the whole product is comparison) and friends but
// no games (add one they already play). No illustration, no centered hero, no
// decorative empty space: a terse line and the one action that fixes it.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { FriendGameSuggestions } from "../games/screens/games/FriendGameSuggestions";
import { PixelIcon, Text, tokens } from "../theme";
import { dayHeading } from "./dayLabels";
import { SpineRule, SpineTick } from "./Spine";

interface EmptyTimelineProps {
  today: string;
  friendsLoading: boolean;
  hasFriends: boolean;
  discovery: DiscoveryGame[];
  discoveryLoading: boolean;
  invitePending: boolean;
  inviteUrl: string | null;
  onAddFriends: () => void;
  onCopyInvite: () => void;
  onAddByUrl: () => void;
  onAddDiscovery: (game: DiscoveryGame) => void;
  addingGameIds: string[];
  addedGameIds: string[];
}

export function EmptyTimeline({
  today,
  friendsLoading,
  hasFriends,
  discovery,
  discoveryLoading,
  invitePending,
  inviteUrl,
  onAddFriends,
  onCopyInvite,
  onAddByUrl,
  onAddDiscovery,
  addingGameIds,
  addedGameIds,
}: EmptyTimelineProps) {
  const heading = dayHeading(today, today);

  if (friendsLoading) {
    return (
      <View style={styles.loading} testID="games-onboarding">
        <ActivityIndicator color={tokens.neon.pink} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      testID="games-onboarding"
    >
      <SpineRule>
        <View style={styles.header}>
          <SpineTick tone="today" />
          <Text variant="heading" tone="spotlight">
            {heading.label}
          </Text>
          <Text variant="eyebrow" tone="muted">
            {heading.date}
          </Text>
          <View style={styles.rule} />
        </View>

        <View style={styles.body}>
          <Text variant="hero" tone="secondary">
            0
          </Text>
          <Text variant="eyebrow" tone="secondary" style={styles.statLabel}>
            {hasFriends ? "Games" : "Friends"}
          </Text>

          {hasFriends ? (
            <>
              <Text tone="secondary" style={styles.pitch}>
                Add a game your friends already play and their scores land here tomorrow morning.
              </Text>
              {discoveryLoading ? (
                <ActivityIndicator color={tokens.neon.pink} style={styles.inlineLoading} />
              ) : discovery.length > 0 ? (
                <FriendGameSuggestions
                  games={discovery}
                  addingGameIds={addingGameIds}
                  addedGameIds={addedGameIds}
                  onAdd={onAddDiscovery}
                  testIDPrefix="games-empty-suggestion"
                />
              ) : (
                <Text tone="secondary" testID="games-empty-no-suggestions">
                  Your friends haven't added any games yet. Add one by URL and they'll see it too.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text tone="secondary" style={styles.pitch}>
                HighScore is a scoreboard, and a scoreboard needs someone to beat. Invite whoever
                you already send your Wordle grid to.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Invite a friend"
                onPress={onAddFriends}
                disabled={invitePending}
                testID="games-empty-add-friends"
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
              >
                {invitePending ? (
                  <ActivityIndicator size="small" color={tokens.neon.pink} />
                ) : (
                  <PixelIcon name="share" size={16} color={tokens.neon.pink} />
                )}
                <Text variant="heading" tone="link">
                  Invite a friend
                </Text>
              </Pressable>
              {inviteUrl ? (
                <View style={styles.inviteBlock}>
                  <Text variant="caption" tone="muted">
                    {Platform.OS === "web"
                      ? "Send this link. Whoever opens it and taps Accept becomes your friend."
                      : "Share this link. Whoever opens it and taps Accept becomes your friend."}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy invite link"
                    onPress={onCopyInvite}
                    testID="games-empty-invite-copy"
                    style={({ pressed }) => [styles.inviteRow, pressed && styles.primaryPressed]}
                  >
                    <Text
                      variant="mono"
                      tone="secondary"
                      numberOfLines={1}
                      style={styles.inviteUrl}
                      testID="games-empty-invite-url"
                    >
                      {inviteUrl}
                    </Text>
                    <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
                  </Pressable>
                </View>
              ) : null}
            </>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a game by URL"
            onPress={onAddByUrl}
            testID="games-empty-add-url"
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.secondary,
              (pressed || hovered) && styles.primaryPressed,
            ]}
          >
            <PixelIcon name="plus" size={16} color={tokens.text.secondary} />
            <Text variant="eyebrow" tone="secondary">
              Add a game by URL
            </Text>
          </Pressable>
        </View>
      </SpineRule>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 40,
    paddingRight: tokens.space.sm,
  },
  rule: { flex: 1, height: tokens.bezel, backgroundColor: tokens.border.default },
  body: { paddingLeft: tokens.gutter, paddingTop: tokens.space.sm, gap: tokens.space.md },
  statLabel: { marginTop: -4 },
  pitch: { maxWidth: 420 },
  inlineLoading: { alignSelf: "flex-start" },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    alignSelf: "flex-start",
    paddingHorizontal: tokens.space.md,
    height: 44,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  primaryPressed: { backgroundColor: tokens.accent.muted },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    alignSelf: "flex-start",
    paddingVertical: tokens.space.sm,
    marginTop: tokens.space.sm,
  },
  inviteBlock: { gap: tokens.space.sm, maxWidth: 420 },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  inviteUrl: { flex: 1, minWidth: 0 },
});
