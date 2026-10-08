// One Home row = one game's box-score line for the selected day. Left: icon +
// title + the leader line. Right: your placing (played) or a POST key (not
// yet). Avatars of the others sit on the leader line and open profiles.
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { memo } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Avatar, PixelIcon, Text, tokens } from "../../theme";
import { placingLabel, type RowSummary, shortName } from "../lib/dayRows";
import { summarizeGameScoreBody } from "../lib/scoresSummary";

export interface BoxScoreRowProps {
  game: MyGame;
  row: RowSummary;
  /** The selected day hasn't loaded yet: titles only, no standings or keys. */
  loading?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onPost: () => void;
  onPressPlayer: (userId: string) => void;
  onMenu: () => void;
}

const FACES = 2;

function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim() : null;
}

export const BoxScoreRow = memo(function BoxScoreRow({
  game,
  row,
  loading = false,
  onPress,
  onLongPress,
  onPost,
  onPressPlayer,
  onMenu,
}: BoxScoreRowProps) {
  const id = game.gameId;
  const mine = row.mine;
  const myLine = mine ? firstLine(summarizeGameScoreBody(game.game, mine)) : null;
  const leaderLine = leaderText(row, mine?.userId ?? null);
  const streak = game.standings.viewerStreak;
  const placing = placingLabel(row);
  // Unplayed rows carry a facepile (who's on the board); played rows already
  // state the placing, so they keep just the leader's face for the title's sake.
  const facepile = mine
    ? row.leader && row.leader.userId !== mine.userId
      ? [row.leader]
      : []
    : row.others.slice(0, FACES);
  const overflow = row.others.length - facepile.length;

  return (
    <View style={styles.root} testID={`game-card-${id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${game.game.title}, open board`}
        testID={`game-card-body-${id}`}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          {game.game.iconUrl ? (
            <Image source={{ uri: game.game.iconUrl }} style={styles.iconImage} />
          ) : (
            <PixelIcon name="gamepad" size={16} />
          )}
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text variant="heading" numberOfLines={1} style={styles.title}>
              {game.game.title}
            </Text>
            {streak >= STREAK_MIN_DAYS ? (
              <Text variant="caption" tone="success" testID={`game-card-streak-${id}`}>
                🔥{streak}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {loading ? (
              "…"
            ) : mine ? (
              <>
                <Text variant="caption" tone="primary">
                  {myLine ?? "played"}
                </Text>
                {leaderLine ? `  ·  ${leaderLine}` : ""}
              </>
            ) : (
              (leaderLine ?? (row.playerCount === 0 ? "Nobody yet" : ""))
            )}
          </Text>
        </View>
      </Pressable>

      <View style={styles.trailing}>
        {loading ? null : facepile.length > 0 ? (
          <View style={styles.faces}>
            {facepile.map((e, i) => (
              <Pressable
                key={e.userId}
                accessibilityRole="button"
                accessibilityLabel={e.displayName ?? "Player"}
                testID={`game-card-avatar-${e.userId}`}
                onPress={() => onPressPlayer(e.userId)}
                style={[styles.face, i > 0 && styles.faceOverlap]}
              >
                <Avatar name={e.displayName} imageUrl={userAvatarImageUrl(e.userId)} size="sm" />
              </Pressable>
            ))}
            {overflow > 0 ? (
              <Text variant="caption" tone="secondary" style={styles.overflow}>
                +{overflow}
              </Text>
            ) : null}
          </View>
        ) : null}
        {loading ? null : mine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${game.game.title} options`}
            testID={`game-card-menu-${id}`}
            onPress={onMenu}
            onLongPress={onLongPress}
            style={({ pressed }) => [styles.placing, pressed && styles.pressed]}
          >
            <Text
              variant="score"
              tone={row.isWin ? "success" : row.isTie ? "spotlight" : "primary"}
              style={styles.placingText}
            >
              {row.isWin ? "👑 " : ""}
              {placing}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Post your ${game.game.title} score`}
            testID={`game-card-paste-${id}`}
            onPress={onPost}
            onLongPress={onMenu}
            style={({ pressed }) => [styles.postKey, pressed && styles.postKeyPressed]}
          >
            <Text variant="heading" style={styles.postLabel}>
              Post
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

function leaderText(row: RowSummary, selfId: string | null): string | null {
  if (row.playerCount === 0) return null;
  const leader = row.leader;
  if (!leader) return `${row.playerCount} played`;
  if (leader.userId === selfId) {
    if (row.playerCount === 1) return "Only you so far";
    return row.isTie ? `tied · ${row.playerCount} played` : `you lead · ${row.playerCount} played`;
  }
  const name = shortName(leader.displayName);
  const value = leader.scoreValue != null ? ` ${formatValue(leader.scoreValue)}` : "";
  return `${name}${value} · ${row.playerCount} played`;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : String(value);
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingLeft: tokens.space.lg,
  },
  pressed: { backgroundColor: tokens.bg.surface },
  icon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  iconImage: { width: 28, height: 28 },
  text: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  title: { flexShrink: 1, fontSize: 11, lineHeight: 16 },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingRight: tokens.space.lg,
  },
  faces: { flexDirection: "row", alignItems: "center" },
  face: {},
  faceOverlap: { marginLeft: -6 },
  overflow: { marginLeft: 4 },
  placing: { minWidth: 84, alignItems: "flex-end", paddingVertical: tokens.space.sm },
  placingText: { fontSize: 11, lineHeight: 16 },
  postKey: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 34,
    justifyContent: "center",
  },
  postKeyPressed: { backgroundColor: tokens.accent.muted },
  postLabel: { color: tokens.neon.pink, fontSize: 9, lineHeight: 12 },
});
