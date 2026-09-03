// One past day in the timeline.
//
// Collapsed by default (yesterday excepted — see `TimelineHome`), because a
// scroll through history should be a list of days, not a wall of scores. The
// day's standings are only fetched once the section is opened, so a feed with
// thirty day headers costs one request.

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameStandingsEntry } from "@workshop/shared/games";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { fetchMyGames } from "../games/api/games";
import { Text, tokens } from "../theme";
import { dayHeading } from "./dayLabels";
import { GameLedger, type LedgerRow } from "./GameLedger";
import { SpineTick } from "./Spine";
import { scoreDisplay } from "./scoreDisplay";
import type { FeedReactionTarget } from "./useFeedReactions";

export function hasScore(entry: GameStandingsEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

export function toLedgerRows(
  game: Parameters<typeof scoreDisplay>[0],
  entries: GameStandingsEntry[],
): LedgerRow[] {
  return entries.filter(hasScore).map((entry) => ({
    userId: entry.userId,
    displayName: entry.displayName,
    rank: entry.rank,
    score: scoreDisplay(game, entry),
    reactions: entry.reactions,
  }));
}

export interface DaySectionProps {
  dateKey: string;
  today: string;
  expanded: boolean;
  /**
   * Fetch this day's scores even while collapsed, so its header can carry a
   * one-line summary. Only the handful of days nearest today opt in — a rail of
   * identical chevron rows is decoration, but thirty preloaded days is rude.
   */
  preload?: boolean;
  onToggle: () => void;
  token: string | null;
  selfId: string | null;
  onOpenGame: (gameId: string) => void;
  onReact: (
    dateKey: string,
    gameId: string,
    userId: string,
    emoji: string,
    currentlyReacted: boolean,
  ) => void;
  onOpenPicker: (target: FeedReactionTarget) => void;
  onMeasure: (dateKey: string, height: number) => void;
}

export function DaySection({
  dateKey,
  today,
  expanded,
  preload = false,
  onToggle,
  token,
  selfId,
  onOpenGame,
  onReact,
  onOpenPicker,
  onMeasure,
}: DaySectionProps) {
  const heading = dayHeading(dateKey, today);
  const query = useQuery({
    queryKey: queryKeys.games.mine(dateKey),
    queryFn: () => fetchMyGames(dateKey, token),
    enabled: !!token && (expanded || preload),
  });

  const played = (query.data?.games ?? [])
    .map((mg) => ({ mg, rows: toLedgerRows(mg.game, mg.standings.entries) }))
    .filter(({ rows }) => rows.length > 0);
  const totalPlays = played.reduce((sum, { rows }) => sum + rows.length, 0);
  const yourPlays = selfId
    ? played.filter(({ rows }) => rows.some((r) => r.userId === selfId)).length
    : 0;
  const summary =
    query.data == null
      ? null
      : totalPlays === 0
        ? "Nobody played"
        : yourPlays > 0
          ? `${totalPlays} plays · you ${yourPlays}`
          : `${totalPlays} plays`;

  const onLayout = (event: LayoutChangeEvent) =>
    onMeasure(dateKey, event.nativeEvent.layout.height);

  return (
    <View onLayout={onLayout} testID={`day-section-${dateKey}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${heading.label}, ${heading.date}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        testID={`day-toggle-${dateKey}`}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.header,
          (pressed || hovered) && styles.headerActive,
        ]}
      >
        <SpineTick tone={expanded ? "open" : "closed"} />
        <Text variant="heading" tone={expanded ? "primary" : "secondary"}>
          {heading.label}
        </Text>
        <Text variant="eyebrow" tone="muted" style={styles.date}>
          {heading.date}
        </Text>
        {expanded ? <View style={styles.rule} /> : null}
        {/* A collapsed day earns its row by saying what happened on it. The
            tick square already says open-vs-closed, so no chevron. */}
        {expanded ? null : (
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.summary}>
            {summary ?? ""}
          </Text>
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {query.isPending ? (
            <ActivityIndicator color={tokens.neon.pink} style={styles.loading} />
          ) : query.isError ? (
            <Text variant="caption" tone="danger">
              Couldn't load this day.
            </Text>
          ) : played.length === 0 ? (
            <Text variant="caption" tone="muted">
              Nobody played.
            </Text>
          ) : (
            played.map(({ mg, rows }) => (
              <GameLedger
                key={mg.gameId}
                gameId={mg.gameId}
                title={mg.game.title}
                iconUrl={mg.game.iconUrl}
                rows={rows}
                selfId={selfId}
                onOpen={() => onOpenGame(mg.gameId)}
                onReact={(userId, emoji, cur) => onReact(dateKey, mg.gameId, userId, emoji, cur)}
                onOpenReactionPicker={(userId) =>
                  onOpenPicker({
                    dateKey,
                    gameId: mg.gameId,
                    scoreUserId: userId,
                    name:
                      mg.standings.entries.find((e) => e.userId === userId)?.displayName ?? null,
                  })
                }
                testIDPrefix={`ledger-${dateKey}`}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 44,
    paddingRight: tokens.space.sm,
  },
  headerActive: { backgroundColor: tokens.bg.surface },
  date: { marginTop: 1 },
  summary: { flex: 1, textAlign: "right" },
  rule: { flex: 1, height: tokens.bezel, backgroundColor: tokens.border.default },
  body: {
    paddingLeft: tokens.gutter,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.lg,
  },
  loading: { alignSelf: "flex-start" },
});
