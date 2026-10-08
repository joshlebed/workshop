// The comparative read, in one line: the day's players for a game as a row of
// avatar cells in rank order, each with its score beneath. The leader gets the
// yellow spotlight bezel; the viewer gets the pink one. Tap a face → that
// person. This is where "people are the social object" survives contact with
// "paths 1 and 2 are rankings": the ranking is drawn *as* people.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { GameStandingsEntry } from "@workshop/shared/games";
import { Pressable, StyleSheet, View } from "react-native";
import { Avatar, Text, tokens } from "../../theme";
import { stripScoreLabel } from "../lib/stripScore";

const MAX_CELLS = 6;

export interface RankStripProps {
  entries: GameStandingsEntry[];
  selfId: string | null;
  onPressPlayer?: (userId: string) => void;
  testIDPrefix?: string;
}

export function RankStrip({ entries, selfId, onPressPlayer, testIDPrefix }: RankStripProps) {
  const shown = entries.slice(0, MAX_CELLS);
  const overflow = entries.length - shown.length;
  return (
    <View style={styles.row}>
      {shown.map((entry) => {
        const isMe = entry.userId === selfId;
        const leads = entry.rank === 1;
        const name = entry.displayName ?? "Someone";
        return (
          <Pressable
            key={entry.userId}
            accessibilityRole="button"
            accessibilityLabel={`${name}${entry.rank ? `, rank ${entry.rank}` : ""}`}
            onPress={onPressPlayer ? () => onPressPlayer(entry.userId) : undefined}
            disabled={!onPressPlayer}
            testID={testIDPrefix ? `${testIDPrefix}-${entry.userId}` : undefined}
            style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
          >
            <View style={[styles.frame, leads && styles.frameLeader, isMe && styles.frameMe]}>
              <Avatar
                name={entry.displayName}
                imageUrl={userAvatarImageUrl(entry.userId)}
                size="md"
              />
            </View>
            <Text
              variant="score"
              tone={leads ? "spotlight" : isMe ? "link" : "primary"}
              numberOfLines={1}
              style={styles.score}
            >
              {stripScoreLabel(entry)}
            </Text>
          </Pressable>
        );
      })}
      {overflow > 0 ? (
        <View style={styles.cell}>
          <View style={[styles.frame, styles.frameMore]}>
            <Text variant="score" tone="secondary" style={styles.moreText}>
              +{overflow}
            </Text>
          </View>
          <Text variant="score" tone="secondary" style={styles.score}>
            {" "}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  cell: { alignItems: "center", gap: 3, width: 44 },
  cellPressed: { opacity: 0.7 },
  frame: { borderWidth: tokens.bezel, borderColor: "transparent", padding: 1 },
  frameLeader: { borderColor: tokens.neon.yellow },
  frameMe: { borderColor: tokens.neon.pink },
  frameMore: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderColor: tokens.border.default,
  },
  moreText: { fontSize: 9, lineHeight: 12, letterSpacing: 0 },
  score: { fontSize: 8, lineHeight: 12, letterSpacing: 0, maxWidth: 44 },
});
