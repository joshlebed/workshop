import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchHeadToHead } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { HeadToHeadDay, HeadToHeadGame, HeadToHeadRange } from "@workshop/shared/friends";
import { formatScoreValue } from "@workshop/shared/games";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  PixelIcon,
  Screen,
  scoreType,
  Text,
  tokens,
} from "../../theme";
import {
  type LeadPoint,
  leadSeries,
  RANGE_OPTIONS,
  recentForm,
  recordLabel,
  shortDate,
  streakLabel,
  totals,
  verdict,
  type WinRecord,
  winPercent,
} from "../lib/headToHead";
import { goBack } from "../lib/navigation";
import { useGamesRuntime } from "../runtime";
import { useToday } from "../state/viewDay";

/**
 * Head to head — `/friends/:userId/versus`. The viewer against one friend:
 * for every game both posted to in the range (7 days, 30 days, all time), how
 * often each played, the days they both played, and the record over those
 * days. Friends only; the server 404s everyone else. All charts are plain
 * views, so the screen reaches every binary by OTA.
 */

const WIN = tokens.neon.chartreuse;
const LOSS = tokens.status.danger;
const TIE = tokens.text.secondary;
const NONE = tokens.border.default;

const OUTCOME_COLOR = { win: WIN, loss: LOSS, tie: TIE, none: NONE } as const;
const OUTCOME_WORD = { win: "won", loss: "lost", tie: "tied", none: "no result" } as const;

const FORM_DAYS = 20;
const LEAD_POINTS = 45;
const LEAD_HALF = 44;

/** Wins · ties · losses as one bar; an even grey track when nothing is decided. */
function SplitBar({ record, height = 10 }: { record: WinRecord; height?: number }) {
  const decided = record.wins + record.losses + record.ties;
  return (
    <View style={[styles.splitBar, { height }]}>
      {decided === 0 ? (
        <View style={[styles.splitSeg, { flex: 1, backgroundColor: NONE }]} />
      ) : (
        <>
          {record.wins > 0 ? (
            <View style={[styles.splitSeg, { flex: record.wins, backgroundColor: WIN }]} />
          ) : null}
          {record.ties > 0 ? (
            <View style={[styles.splitSeg, { flex: record.ties, backgroundColor: TIE }]} />
          ) : null}
          {record.losses > 0 ? (
            <View style={[styles.splitSeg, { flex: record.losses, backgroundColor: LOSS }]} />
          ) : null}
        </>
      )}
    </View>
  );
}

/** Running lead by day: columns above the line when you're ahead, below when behind. */
function LeadChart({ points, friendName }: { points: LeadPoint[]; friendName: string }) {
  const max = points.reduce((m, p) => Math.max(m, Math.abs(p.lead)), 0) || 1;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const peak = points.reduce((m, p) => Math.max(m, p.lead), 0);
  const trough = points.reduce((m, p) => Math.min(m, p.lead), 0);
  return (
    <View
      style={styles.leadRoot}
      accessible
      accessibilityLabel={`Running lead from ${shortDate(first.periodKey)} to ${shortDate(
        last.periodKey,
      )}. Your biggest lead ${peak}, ${friendName}'s biggest lead ${-trough}, now ${last.lead}.`}
      testID="h2h-lead-chart"
    >
      <Text variant="caption" tone="muted">
        You ahead{peak > 0 ? ` · up to +${peak}` : ""}
      </Text>
      <View style={styles.leadPlot}>
        <View style={styles.leadColumns}>
          {points.map((p) => {
            const h = Math.max(Math.round((Math.abs(p.lead) / max) * LEAD_HALF), 2);
            return (
              <View key={p.periodKey} style={styles.leadColumn}>
                <View style={styles.leadHalfTop}>
                  {p.lead > 0 ? (
                    <View style={[styles.leadBar, { height: h, backgroundColor: WIN }]} />
                  ) : null}
                </View>
                <View style={styles.leadHalfBottom}>
                  {p.lead < 0 ? (
                    <View style={[styles.leadBar, { height: h, backgroundColor: LOSS }]} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.leadAxis} />
      </View>
      <Text variant="caption" tone="muted">
        {friendName} ahead{trough < 0 ? ` · up to +${-trough}` : ""}
      </Text>
      <View style={styles.leadDates}>
        <Text variant="caption" tone="muted">
          {shortDate(first.periodKey)}
        </Text>
        <Text variant="caption" tone="muted">
          {shortDate(last.periodKey)}
        </Text>
      </View>
    </View>
  );
}

/** The last shared days as squares, oldest left: green won, red lost, grey tied. */
function FormStrip({ days }: { days: HeadToHeadDay[] }) {
  const summary = days.map((d) => `${shortDate(d.periodKey)} ${OUTCOME_WORD[d.outcome]}`);
  return (
    <View
      style={styles.form}
      accessible
      accessibilityLabel={`Last ${days.length} days you both played: ${summary.join(", ")}`}
    >
      {days.map((d) => (
        <View
          key={d.periodKey}
          style={[
            styles.formCell,
            d.outcome === "none"
              ? styles.formCellNone
              : { backgroundColor: OUTCOME_COLOR[d.outcome] },
          ]}
        />
      ))}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={2} style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

function GameCard({ row, friendName }: { row: HeadToHeadGame; friendName: string }) {
  const pct = winPercent(row);
  const streak = streakLabel(row.days, friendName);
  const form = recentForm(row.days, FORM_DAYS);
  const unit = row.game.scoreUnit;
  const avg = (v: number | null) =>
    v === null ? "–" : formatScoreValue(Math.round(v * 10) / 10, unit);
  const hasAverages = row.viewer.averageScore !== null || row.friend.averageScore !== null;
  return (
    <View style={styles.card} testID={`h2h-game-${row.game.id}`}>
      <View style={styles.gameHead}>
        <View style={styles.gameCover}>
          {row.game.iconUrl ? (
            <Image
              source={{ uri: row.game.iconUrl }}
              style={styles.gameCoverImage}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={styles.gameCoverGlyph}>🎮</Text>
          )}
        </View>
        <View style={styles.gameHeadText}>
          <Text variant="game" numberOfLines={1}>
            {row.game.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {verdict(row, friendName)}
          </Text>
        </View>
        <View style={styles.gameRecord}>
          <Text style={styles.gameRecordValue}>{recordLabel(row)}</Text>
          <Text variant="caption" tone="muted">
            {pct === null ? "no record" : `${pct}% won`}
          </Text>
        </View>
      </View>

      <SplitBar record={row} />

      <View style={styles.stats}>
        <Stat value={String(row.viewer.plays)} label="You played" />
        <Stat value={String(row.friend.plays)} label={`${friendName} played`} />
        <Stat value={String(row.sharedDays)} label="Same day" />
      </View>

      {form.length > 0 ? (
        <View style={styles.formBlock}>
          <View style={styles.formHead}>
            <Text variant="overline" tone="muted">
              {form.length < row.days.length ? `Last ${form.length} same days` : "Same days"}
            </Text>
            {streak ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {streak}
              </Text>
            ) : null}
          </View>
          <FormStrip days={form} />
        </View>
      ) : null}

      {hasAverages ? (
        <Text variant="caption" tone="muted">
          Average score · You {avg(row.viewer.averageScore)} · {friendName}{" "}
          {avg(row.friend.averageScore)}
          {row.game.scoreDirection === "asc" ? " · lower wins" : ""}
        </Text>
      ) : null}
    </View>
  );
}

export default function HeadToHeadScreen() {
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = typeof params.userId === "string" ? params.userId : "";
  const { token, user, routes } = useGamesRuntime();
  const today = useToday();
  const [range, setRange] = useState<HeadToHeadRange>("30");

  const query = useQuery({
    queryKey: queryKeys.friends.headToHead(userId, range, today),
    queryFn: () => fetchHeadToHead(userId, range, today, token),
    enabled: !!token && !!userId,
    // Keep the last range on screen while the next one loads.
    placeholderData: (prev) => prev,
  });
  const data = query.data;
  const back = () => goBack(routes.friendProfile(userId));

  const friendName = data?.friend.displayName?.trim() || "Them";
  const games = data?.games ?? [];
  const all = totals(games);
  const overallPct = winPercent(all);
  const lead = leadSeries(games, LEAD_POINTS);
  const rangeWords = range === "all" ? "all time" : `the last ${range === "7" ? "7" : "30"} days`;

  return (
    <Screen testID="head-to-head-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          testID="h2h-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="title">Head to head</Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.ranges} accessibilityRole="tablist">
          {RANGE_OPTIONS.map((o) => (
            <Chip
              key={o.range}
              label={o.label}
              selected={range === o.range}
              onPress={() => setRange(o.range)}
              testID={`h2h-range-${o.range}`}
              style={styles.rangeChip}
            />
          ))}
        </View>

        {query.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : query.isError || !data ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load this matchup"
              description={errorMessage(query.error, "Head to head is for friends.")}
              action={<Button label="Back" variant="secondary" onPress={back} />}
            />
          </View>
        ) : (
          <View style={[styles.sections, query.isPlaceholderData && styles.stale]}>
            {/* Scoreboard: the two of you, the record, and how it splits. */}
            <View style={styles.card} testID="h2h-scoreboard">
              <View style={styles.versus}>
                <View style={styles.player}>
                  <Avatar
                    name={user?.displayName ?? null}
                    imageUrl={user?.id ? userAvatarImageUrl(user.id) : undefined}
                    size="lg"
                  />
                  <Text variant="label" numberOfLines={1}>
                    You
                  </Text>
                </View>
                <View style={styles.bigRecord}>
                  <Text style={[styles.bigNumber, { color: WIN }]} testID="h2h-wins">
                    {all.wins}
                  </Text>
                  <Text style={styles.bigDash}>–</Text>
                  <Text style={[styles.bigNumber, { color: LOSS }]} testID="h2h-losses">
                    {all.losses}
                  </Text>
                </View>
                <View style={styles.player}>
                  <Avatar
                    name={data.friend.displayName}
                    imageUrl={userAvatarImageUrl(data.friend.userId)}
                    size="lg"
                  />
                  <Text variant="label" numberOfLines={1}>
                    {friendName}
                  </Text>
                </View>
              </View>
              <SplitBar record={all} height={14} />
              <Text variant="heading" style={styles.verdict} testID="h2h-verdict">
                {games.length === 0 ? "Nothing to compare yet" : verdict(all, friendName)}
              </Text>
              <Text variant="caption" tone="muted" style={styles.verdictSub}>
                {games.length === 0
                  ? `You and ${friendName} haven't played the same game in ${rangeWords}.`
                  : `${all.sharedDays} ${all.sharedDays === 1 ? "day" : "days"} played against each other across ${
                      games.length
                    } ${games.length === 1 ? "game" : "games"}${
                      overallPct === null ? "" : ` · you won ${overallPct}%`
                    }${all.ties > 0 ? ` · ${all.ties} tied` : ""}`}
              </Text>
              {games.length > 1 ? (
                <View style={styles.stats}>
                  <Stat value={String(all.gamesLed)} label="Games you lead" />
                  <Stat value={String(all.gamesLevel)} label="Level" />
                  <Stat value={String(all.gamesTrailed)} label={`${friendName} leads`} />
                </View>
              ) : null}
              {games.length === 0 && range !== "all" ? (
                <Button
                  label="Look at all time"
                  variant="secondary"
                  onPress={() => setRange("all")}
                  testID="h2h-all-time"
                />
              ) : null}
            </View>

            {lead.length > 1 ? (
              <View style={styles.card}>
                <Text variant="heading">Who's been ahead</Text>
                <Text variant="caption" tone="muted">
                  Wins minus losses across every game, day by day.
                </Text>
                <LeadChart points={lead} friendName={friendName} />
              </View>
            ) : null}

            {games.length > 0 ? (
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: WIN }]} />
                  <Text variant="caption" tone="secondary">
                    You won
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: TIE }]} />
                  <Text variant="caption" tone="secondary">
                    Tied
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: LOSS }]} />
                  <Text variant="caption" tone="secondary">
                    {friendName} won
                  </Text>
                </View>
              </View>
            ) : null}

            {games.map((row) => (
              <GameCard key={row.game.id} row={row} friendName={friendName} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const COVER = 40;

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  ranges: { flexDirection: "row", gap: tokens.space.sm },
  rangeChip: { flex: 1, minHeight: 40 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xl },
  sections: { gap: tokens.space.lg },
  stale: { opacity: 0.5 },
  card: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },

  versus: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  player: { flex: 1, minWidth: 0, alignItems: "center", gap: tokens.space.xs },
  bigRecord: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  bigNumber: { ...scoreType(28) },
  bigDash: { ...scoreType(18), color: tokens.text.secondary },
  verdict: { textAlign: "center" },
  verdictSub: { textAlign: "center" },

  splitBar: {
    flexDirection: "row",
    gap: 2,
    borderRadius: tokens.radius.sm,
    overflow: "hidden",
  },
  splitSeg: { minWidth: 4 },

  stats: { flexDirection: "row", gap: tokens.space.sm },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 2,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.xs,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  statValue: { ...scoreType(14), color: tokens.text.primary },
  statLabel: { textAlign: "center" },

  leadPlot: { height: LEAD_HALF * 2 + 2, marginVertical: tokens.space.xs },
  leadColumns: { flexDirection: "row", gap: 2, height: LEAD_HALF * 2 + 2 },
  leadColumn: { flex: 1, minWidth: 1 },
  leadHalfTop: { height: LEAD_HALF, justifyContent: "flex-end", marginBottom: 2 },
  leadHalfBottom: { height: LEAD_HALF, justifyContent: "flex-start" },
  leadBar: { borderRadius: 1 },
  leadAxis: {
    position: "absolute",
    left: 0,
    right: 0,
    top: LEAD_HALF,
    height: 2,
    backgroundColor: tokens.border.default,
  },
  leadRoot: { gap: 2 },
  leadDates: { flexDirection: "row", justifyContent: "space-between" },

  legend: { flexDirection: "row", justifyContent: "center", gap: tokens.space.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },

  gameHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  gameCover: {
    width: COVER,
    height: COVER,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gameCoverImage: { width: COVER, height: COVER, borderRadius: tokens.radius.sm },
  gameCoverGlyph: { fontSize: 20 },
  gameHeadText: { flex: 1, minWidth: 0, gap: 2 },
  gameRecord: { alignItems: "flex-end", gap: 2 },
  gameRecordValue: { ...scoreType(14), color: tokens.text.primary },

  formBlock: { gap: tokens.space.xs },
  formHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
  },
  form: { flexDirection: "row", gap: 3 },
  formCell: { flex: 1, maxWidth: 16, height: 12, borderRadius: 2 },
  formCellNone: { borderWidth: 1, borderColor: NONE },
});
