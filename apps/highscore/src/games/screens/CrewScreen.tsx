// A crew's screen (`/crews/:id`, spike #8): the invite link to share again,
// today's crew board (standings among crew members per game, from
// `GET /v1/crews/:id/board`), the member list and a quiet Leave. The server
// decides who is visible — a member you unfriended or a blocked pair never
// shows scores — so this screen only draws what it gets.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchCrewBoard, leaveCrew } from "@workshop/api-client/crews";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { CrewBoardGame } from "@workshop/shared/crews";
import { formatScoreValue } from "@workshop/shared/games";
import { confirm, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  Avatar,
  Button,
  bodyType,
  EmptyState,
  PixelIcon,
  Screen,
  scoreType,
  sectionLabelType,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { addGame } from "../api/games";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { memberCountLabel } from "../lib/crews";
import { localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { prewarmShareCard } from "../lib/prewarmShareCard";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

const COVER = 32;
const SCORE_COLUMN = 56;

export default function CrewScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const crewId = (Array.isArray(params.id) ? params.id[0] : params.id) ?? "";
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const openProfile = useOpenProfile();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const today = localDateKey();
  const [adding, setAdding] = useState<string[]>([]);

  const boardQuery = useQuery({
    queryKey: queryKeys.crews.board(crewId, today),
    queryFn: () => fetchCrewBoard(crewId, today, token),
    enabled: !!token && !!crewId,
    refetchInterval: livePoll,
  });
  const board = boardQuery.data;

  const share = async () => {
    if (!board) return;
    prewarmShareCard(board.crew.url);
    const result = await shareOrCopyLink(board.crew.url);
    if (result === "copied") showToast({ message: "Crew link copied", tone: "success" });
    else if (result === "failed") {
      showToast({ message: "Couldn't copy — copy the link below.", tone: "danger" });
    }
  };

  const addMutation = useMutation({
    mutationFn: (g: CrewBoardGame) => addGame(g.game.url, token),
    onMutate: (g) => setAdding((ids) => [...ids, g.game.id]),
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.crews.board(crewId, today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
    onSettled: (_d, _e, g) => setAdding((ids) => ids.filter((id) => id !== g.game.id)),
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveCrew(crewId, token),
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: queryKeys.crews.mine });
      router.replace(routes.friends as Href);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't leave the crew."), tone: "danger" }),
  });

  const onLeave = async () => {
    const ok = await confirm({
      title: `Leave ${board?.crew.name ?? "this crew"}?`,
      message: "You'll stay friends with everyone. You can rejoin with the link.",
      confirmLabel: "Leave",
      destructive: true,
    });
    if (ok) leaveMutation.mutate();
  };

  return (
    <Screen testID="crew-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack(routes.friends)}
          testID="crew-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="title" numberOfLines={1} style={styles.headerTitle} testID="crew-name">
          {board?.crew.name ?? "Crew"}
        </Text>
        <View style={styles.navButton} />
      </View>

      {boardQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : boardQuery.isError || !board ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load this crew"
            description={errorMessage(boardQuery.error, "You may not be in it anymore.")}
            action={
              <Button
                label="Back to Friends"
                variant="secondary"
                onPress={() => router.replace(routes.friends as Href)}
              />
            }
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {/* The door: share the link again. */}
          <View style={styles.inviteCard} testID="crew-invite">
            <Text variant="caption" tone="muted">
              {memberCountLabel(board.crew.memberCount)} · everyone who joins becomes friends with
              everyone in the crew.
            </Text>
            <Button label="Share crew link" onPress={share} testID="crew-share" />
            <View style={styles.urlField}>
              <Text
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                testID="crew-url"
                selectable
              >
                {board.crew.url}
              </Text>
            </View>
          </View>

          {/* Today's crew board. */}
          <View style={styles.group} testID="crew-board">
            <Text style={styles.sectionLabel}>Today</Text>
            {board.games.length === 0 ? (
              <Text tone="secondary" style={styles.emptyLine} testID="crew-board-empty">
                Nobody in the crew has posted today yet.
              </Text>
            ) : (
              board.games.map((g) => (
                <View
                  key={g.game.id}
                  style={styles.gameBlock}
                  testID={`crew-board-game-${g.game.id}`}
                >
                  <Pressable
                    onPress={
                      g.inMyGames ? () => router.push(routes.game(g.game.id) as Href) : undefined
                    }
                    disabled={!g.inMyGames}
                    accessibilityLabel={g.game.title}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.gameHead,
                      g.inMyGames && (pressed || hovered) && styles.rowHover,
                    ]}
                  >
                    <View style={styles.gameCover}>
                      {g.game.iconUrl ? (
                        <Image source={{ uri: g.game.iconUrl }} style={styles.gameCoverImage} />
                      ) : (
                        <Text style={styles.gameCoverGlyph}>🎮</Text>
                      )}
                    </View>
                    <Text variant="game" numberOfLines={1} style={styles.gameTitle}>
                      {g.game.title}
                    </Text>
                    {g.inMyGames ? null : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${g.game.title}`}
                        onPress={() => addMutation.mutate(g)}
                        disabled={adding.includes(g.game.id)}
                        hitSlop={8}
                        testID={`crew-board-add-${g.game.id}`}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.addBtn,
                          (pressed || hovered) && styles.addBtnHover,
                        ]}
                      >
                        {adding.includes(g.game.id) ? (
                          <ActivityIndicator size="small" color={tokens.accent.default} />
                        ) : (
                          <Text variant="label" style={styles.addLabel}>
                            Add
                          </Text>
                        )}
                      </Pressable>
                    )}
                  </Pressable>
                  {g.entries.map((e) => (
                    <View
                      key={e.userId}
                      style={styles.entryRow}
                      testID={`crew-board-entry-${g.game.id}-${e.userId}`}
                    >
                      <Text style={styles.rank}>{e.rank ?? "–"}</Text>
                      <Avatar
                        name={e.displayName}
                        imageUrl={userAvatarImageUrl(e.userId, e.avatarVersion)}
                        size="sm"
                      />
                      <Text variant="label" numberOfLines={1} style={styles.entryName}>
                        {e.displayName?.trim() || "Someone"}
                      </Text>
                      <View style={styles.scoreBox}>
                        <Text style={styles.scoreBoxText}>
                          {e.scoreValue !== null
                            ? formatScoreValue(e.scoreValue, g.game.scoreUnit)
                            : "✓"}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>

          {/* Members. */}
          <View style={styles.group} testID="crew-members">
            <Text style={styles.sectionLabel}>{memberCountLabel(board.members.length)}</Text>
            {board.members.map((m) => {
              const name = m.displayName?.trim() || "Someone";
              const line = m.isViewer
                ? m.isCreator
                  ? "You · started the crew"
                  : "You"
                : m.isCreator
                  ? "Started the crew"
                  : m.isFriend
                    ? "Friend"
                    : "Not friends — scores hidden";
              return (
                <Pressable
                  key={m.userId}
                  onPress={m.isViewer ? undefined : () => openProfile(m.userId)}
                  disabled={m.isViewer}
                  accessibilityLabel={m.isViewer ? name : `View ${name}'s profile`}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.memberRow,
                    !m.isViewer && (pressed || hovered) && styles.rowHover,
                  ]}
                  testID={`crew-member-${m.userId}`}
                >
                  <Avatar
                    name={m.displayName}
                    imageUrl={userAvatarImageUrl(m.userId, m.avatarVersion)}
                    size="md"
                  />
                  <View style={styles.memberText}>
                    <Text variant="label" numberOfLines={1} style={styles.memberName}>
                      {name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {line}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onLeave}
            disabled={leaveMutation.isPending}
            testID="crew-leave"
            style={({ pressed }) => [styles.quietRow, pressed && styles.quietPressed]}
          >
            <Text style={styles.leaveLabel}>
              {leaveMutation.isPending ? "Leaving…" : "Leave crew"}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  headerTitle: { flex: 1, textAlign: "center" },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xl },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.xl,
  },
  inviteCard: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  urlField: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
  },
  group: { gap: tokens.space.xs },
  sectionLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  emptyLine: { paddingVertical: tokens.space.md },
  gameBlock: {
    paddingBottom: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.default,
  },
  gameHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 52,
    marginHorizontal: -tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  gameCover: {
    width: COVER,
    height: COVER,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gameCoverImage: { width: COVER, height: COVER, borderRadius: tokens.radius.sm },
  gameCoverGlyph: { fontSize: 18 },
  gameTitle: { flex: 1, minWidth: 0, color: tokens.text.primary },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 40,
    paddingLeft: tokens.space.xs,
  },
  rank: { ...scoreType(10), width: 20, textAlign: "center", color: tokens.text.secondary },
  entryName: { ...bodyType("medium"), flex: 1, minWidth: 0, color: tokens.text.primary },
  scoreBox: {
    minWidth: SCORE_COLUMN,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    alignItems: "center",
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  scoreBoxText: { ...scoreType(10), lineHeight: 14, color: tokens.text.primary },
  addBtn: {
    minWidth: 52,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  addBtnHover: { backgroundColor: tokens.accent.muted },
  addLabel: { ...bodyType("semibold"), color: tokens.neon.pinkTint },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 56,
    marginHorizontal: -tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.default,
  },
  memberText: { flex: 1, minWidth: 0, gap: 2 },
  memberName: { ...bodyType("medium"), fontSize: tokens.font.size.md, color: tokens.text.primary },
  quietRow: { paddingVertical: tokens.space.md },
  quietPressed: { opacity: 0.6 },
  leaveLabel: { ...bodyType("semibold"), color: tokens.status.danger },
});
