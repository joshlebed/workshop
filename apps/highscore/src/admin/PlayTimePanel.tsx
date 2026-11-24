// The "Play time" tab of HighScore's admin dashboard: how long players spend
// on their daily games, estimated from score-post timestamps
// (`GET /v1/admin/play-time`; the model is in the backend's
// `lib/adminPlayTime.ts`). Pick a player on the left, a day from their bars,
// and the day's posts are drawn on a 24-hour track and per session.
// Plain views with percentage positions, so it renders the same on iOS.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  AdminPlayEstimateSource,
  AdminPlayEvent,
  AdminPlaySession,
  AdminPlayTimeDayResponse,
  AdminPlayTimeResponse,
  AdminPlayTimeUser,
} from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { fetchAdminPlayTime, fetchAdminPlayTimeDay } from "../api/admin";
import { useAuth } from "../hooks/useAuth";
import { Button, Card, Chip, IconButton, PixelIcon, Text, tokens } from "../theme";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const WIDE = 900;
const DAY_MINUTES = 1440;
const SOURCE_LABEL: Record<AdminPlayEstimateSource, string> = {
  gap: "since previous post",
  timer: "game's own timer",
  typical: "typical for this game",
  backfill: "old day pasted late — not counted",
};
// Alternating block colours in the session lanes, so neighbours read apart.
const BLOCK_COLORS = [tokens.neon.pink, tokens.neon.yellow, tokens.neon.chartreuse];

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function formatClock(minute: number): string {
  const total = Math.floor(minute);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${suffix}`;
}

function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const pct = (minute: number) =>
  `${(Math.min(DAY_MINUTES, Math.max(0, minute)) / DAY_MINUTES) * 100}%` as const;

export function PlayTimePanel() {
  const { token } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ player?: string; day?: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [range, setRange] = useState<Range>(30);

  const query = useQuery<AdminPlayTimeResponse>({
    queryKey: queryKeys.admin.playTime(range),
    queryFn: () => fetchAdminPlayTime(token, range),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const players = query.data?.users ?? [];
  const player =
    players.find((u) => u.id === params.player) ?? (params.player ? undefined : players[0]);
  const lastActive = player?.days[player.days.length - 1]?.day;
  const day =
    typeof params.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.day)
      ? params.day
      : lastActive;

  const setPlayer = (id: string) => router.setParams({ player: id, day: undefined });
  const setDay = (next: string) => router.setParams({ player: player?.id, day: next });

  return (
    <View style={styles.body} testID="admin-playtime">
      <View style={styles.row}>
        {RANGES.map((days) => (
          <Chip
            key={days}
            label={`${days} days`}
            selected={range === days}
            onPress={() => setRange(days)}
            testID={`admin-playtime-range-${days}`}
          />
        ))}
      </View>
      <Text variant="caption" tone="secondary">
        Estimated from when scores were posted. Posts under {query.data?.sessionGapMinutes ?? 20}{" "}
        min apart are one sitting; each post counts the time since the one before it. A sitting's
        first post counts the game's own timer, or the median time players spend on that game.
      </Text>

      {query.isError ? (
        <Card>
          <Text tone="danger">{errorMessage(query.error)}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void query.refetch()} />
        </Card>
      ) : null}
      {query.isLoading ? <ActivityIndicator color={tokens.accent.default} /> : null}

      {query.data ? (
        <View style={[styles.layout, wide && styles.layoutWide]}>
          <PlayerList
            players={players}
            selectedId={player?.id ?? null}
            onSelect={setPlayer}
            style={wide ? styles.listWide : styles.listNarrow}
          />
          <View style={styles.detail}>
            {player && day ? (
              <PlayerDetail player={player} day={day} rangeDays={range} onDay={setDay} />
            ) : (
              <Card>
                <Text tone="secondary">No player selected.</Text>
              </Card>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PlayerList({
  players,
  selectedId,
  onSelect,
  style,
}: {
  players: AdminPlayTimeUser[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  style: object;
}) {
  const max = Math.max(1, ...players.map((p) => p.avgSecondsPerActiveDay));
  return (
    <Card style={[styles.list, style]} testID="admin-playtime-players">
      <View style={styles.listHeader}>
        <Text variant="overline" tone="muted" style={styles.flex}>
          Player · by total time
        </Text>
        <Text variant="overline" tone="muted">
          Avg / day
        </Text>
      </View>
      <ScrollView style={styles.listScroll} nestedScrollEnabled>
        {players.map((p, i) => {
          const selected = p.id === selectedId;
          return (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p.id)}
              style={[styles.playerRow, selected && styles.playerRowSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`admin-playtime-player-${p.id}`}
            >
              <Text variant="caption" tone="muted" style={styles.rank}>
                {i + 1}
              </Text>
              <View style={styles.flex}>
                <Text numberOfLines={1} tone={selected ? "link" : "primary"}>
                  {p.displayName ?? p.email ?? "Unnamed"}
                </Text>
                <View style={styles.avgTrack}>
                  <View
                    style={[
                      styles.avgFill,
                      { width: `${(p.avgSecondsPerActiveDay / max) * 100}%` },
                    ]}
                  />
                </View>
                <Text variant="caption" tone="muted">
                  {p.activeDays} days · {p.scores} scores · {formatDuration(p.totalSeconds)} total
                </Text>
              </View>
              <Text variant="label">{formatDuration(p.avgSecondsPerActiveDay)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Card>
  );
}

function PlayerDetail({
  player,
  day,
  rangeDays,
  onDay,
}: {
  player: AdminPlayTimeUser;
  day: string;
  rangeDays: number;
  onDay: (day: string) => void;
}) {
  const { token } = useAuth();
  const dayQuery = useQuery<AdminPlayTimeDayResponse>({
    queryKey: queryKeys.admin.playTimeDay(player.id, day),
    queryFn: () => fetchAdminPlayTimeDay(token, player.id, day),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const byDay = useMemo(() => new Map(player.days.map((d) => [d.day, d])), [player.days]);
  const today = todayIn(player.timezone);
  const strip = useMemo(() => {
    const end = today > day ? today : day;
    return Array.from({ length: rangeDays }, (_, i) => addDays(end, i - rangeDays + 1));
  }, [today, day, rangeDays]);
  const maxSeconds = Math.max(60, ...player.days.map((d) => d.seconds));
  const med = median(player.days.map((d) => d.seconds));

  return (
    <View style={styles.detailBody}>
      <Card>
        <Text variant="heading">{player.displayName ?? player.email ?? "Unnamed"}</Text>
        <Text variant="caption" tone="secondary">
          {player.timezone}
          {player.timezoneAssumed ? " (assumed — no push token)" : ""} · avg{" "}
          {formatDuration(player.avgSecondsPerActiveDay)} · median {formatDuration(med)} per active
          day · {player.activeDays} of {rangeDays} days
        </Text>
        <View style={styles.strip} testID="admin-playtime-days">
          {strip.map((d) => {
            const info = byDay.get(d);
            const selected = d === day;
            const h = info ? Math.max(4, (info.seconds / maxSeconds) * 100) : 2;
            return (
              <Pressable
                key={d}
                onPress={() => onDay(d)}
                style={[styles.stripCol, selected && styles.stripColSelected]}
                accessibilityRole="button"
                accessibilityLabel={`${formatDay(d)}: ${info ? formatDuration(info.seconds) : "no play"}`}
                testID={`admin-playtime-day-${d}`}
              >
                <View
                  style={[
                    styles.stripBar,
                    {
                      height: `${h}%`,
                      backgroundColor: info
                        ? selected
                          ? tokens.neon.yellow
                          : tokens.neon.pink
                        : tokens.border.default,
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.stripAxis}>
          <Text variant="caption" tone="muted">
            {formatDay(strip[0] as string)}
          </Text>
          <Text variant="caption" tone="muted">
            peak {formatDuration(maxSeconds)}
          </Text>
          <Text variant="caption" tone="muted">
            {formatDay(strip[strip.length - 1] as string)}
          </Text>
        </View>
      </Card>

      <Card>
        <View style={styles.dayNav}>
          <IconButton
            accessibilityLabel="Previous day"
            onPress={() => onDay(addDays(day, -1))}
            testID="admin-playtime-prev"
          >
            <PixelIcon name="chevron-left" size={24} color={tokens.text.secondary} />
          </IconButton>
          <View style={styles.dayTitle}>
            <Text variant="heading">{formatDay(day)}</Text>
            <Text variant="caption" tone="secondary" testID="admin-playtime-day-total">
              {dayQuery.data
                ? `${formatDuration(dayQuery.data.seconds)} estimated · ${dayQuery.data.events.length} posts · ${dayQuery.data.sessions.length} ${dayQuery.data.sessions.length === 1 ? "sitting" : "sittings"}`
                : " "}
            </Text>
          </View>
          <IconButton
            accessibilityLabel="Next day"
            onPress={() => onDay(addDays(day, 1))}
            testID="admin-playtime-next"
          >
            <PixelIcon name="chevron-right" size={24} color={tokens.text.secondary} />
          </IconButton>
        </View>

        {dayQuery.isError ? <Text tone="danger">{errorMessage(dayQuery.error)}</Text> : null}
        {dayQuery.isLoading ? <ActivityIndicator color={tokens.accent.default} /> : null}
        {dayQuery.data ? <DayView data={dayQuery.data} /> : null}
      </Card>
    </View>
  );
}

function DayView({ data }: { data: AdminPlayTimeDayResponse }) {
  if (data.events.length === 0) {
    return (
      <Text tone="secondary" style={styles.gapTop}>
        No scores posted this day.
      </Text>
    );
  }
  return (
    <View style={styles.gapTop}>
      <Text variant="overline" tone="muted">
        24 hours ({data.timezone})
      </Text>
      <View style={styles.dayTrack} testID="admin-playtime-track">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <View key={h} style={[styles.hourLine, { left: pct(h * 60) }]} />
        ))}
        {data.sessions.map((s) => (
          <View
            key={s.start}
            style={[
              styles.sessionBand,
              {
                left: pct(s.startMinute),
                width: `${Math.max(0.4, ((s.endMinute - s.startMinute) / DAY_MINUTES) * 100)}%`,
              },
            ]}
          />
        ))}
        {data.events.map((e) => (
          <View
            key={e.at + e.gameId}
            style={[
              styles.tick,
              { left: pct(e.localMinute) },
              e.source === "backfill" && styles.tickBackfill,
            ]}
          />
        ))}
      </View>
      <View style={styles.hourLabels}>
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <Text
            key={h}
            variant="caption"
            tone="muted"
            style={[styles.hourLabel, { left: pct(h * 60) }]}
          >
            {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
          </Text>
        ))}
      </View>

      {data.sessions.map((s, i) => (
        <SessionLane
          key={s.start}
          index={i}
          session={s}
          events={data.events.filter((e) => e.session === i)}
        />
      ))}

      {data.events.some((e) => e.source === "backfill") ? (
        <View style={styles.gapTop}>
          <Text variant="overline" tone="muted">
            Not counted
          </Text>
          {data.events
            .filter((e) => e.source === "backfill")
            .map((e) => (
              <EventRow key={e.at + e.gameId} event={e} color={tokens.border.default} />
            ))}
        </View>
      ) : null}
    </View>
  );
}

function SessionLane({
  index,
  session,
  events,
}: {
  index: number;
  session: AdminPlaySession;
  events: AdminPlayEvent[];
}) {
  const span = Math.max(1, session.endMinute - session.startMinute);
  return (
    <View style={styles.session} testID={`admin-playtime-session-${index}`}>
      <Text variant="label">
        Sitting {index + 1}: {formatClock(session.startMinute)}–{formatClock(session.endMinute)} ·{" "}
        {formatDuration(session.seconds)} · {session.scores} games
      </Text>
      <View style={styles.lane}>
        {events.map((e, i) => {
          const start = e.localMinute - e.estimatedSeconds / 60;
          return (
            <View
              key={e.at + e.gameId}
              style={[
                styles.block,
                {
                  left: `${((start - session.startMinute) / span) * 100}%`,
                  width: `${Math.max(0.6, (e.estimatedSeconds / 60 / span) * 100)}%`,
                  backgroundColor: BLOCK_COLORS[i % BLOCK_COLORS.length],
                  opacity: e.source === "gap" ? 1 : 0.55,
                },
              ]}
            />
          );
        })}
      </View>
      {events.map((e, i) => (
        <EventRow
          key={e.at + e.gameId}
          event={e}
          color={BLOCK_COLORS[i % BLOCK_COLORS.length] as string}
        />
      ))}
    </View>
  );
}

function EventRow({ event, color }: { event: AdminPlayEvent; color: string }) {
  return (
    <View style={styles.eventRow}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text variant="caption" tone="secondary" style={styles.eventTime}>
        {formatClock(event.localMinute)}
      </Text>
      <View style={styles.flex}>
        <Text numberOfLines={1}>
          {event.gameTitle}
          {event.summary ? (
            <Text variant="caption" tone="muted">
              {"  "}
              {event.summary.split("\n")[0]}
            </Text>
          ) : null}
        </Text>
        <Text variant="caption" tone="muted">
          {SOURCE_LABEL[event.source]}
          {event.periodKey !== undefined && event.source === "backfill"
            ? ` (${event.periodKey})`
            : ""}
          {event.entrySource === "share_extension" ? " · share sheet" : ""}
        </Text>
      </View>
      <Text variant="label">
        {event.source === "backfill" ? "—" : formatDuration(event.estimatedSeconds)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: tokens.space.md },
  row: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  layout: { gap: tokens.space.md },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  list: { padding: 0, overflow: "hidden" },
  listWide: { width: 340 },
  listNarrow: {},
  listHeader: {
    flexDirection: "row",
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  listScroll: { maxHeight: 640 },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.subtle,
  },
  playerRowSelected: { backgroundColor: tokens.accent.muted },
  rank: { width: 20, textAlign: "right" },
  avgTrack: {
    height: 4,
    backgroundColor: tokens.bg.elevated,
    borderRadius: 2,
    marginVertical: 3,
    overflow: "hidden",
  },
  avgFill: { height: 4, backgroundColor: tokens.neon.pink, borderRadius: 2 },
  detail: { flex: 1, minWidth: 0 },
  detailBody: { gap: tokens.space.md },
  strip: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 90,
    gap: 2,
    marginTop: tokens.space.md,
  },
  stripCol: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
    borderRadius: 2,
  },
  stripColSelected: { backgroundColor: tokens.bg.elevated },
  stripBar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  stripAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  dayNav: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  dayTitle: { flex: 1, alignItems: "center" },
  gapTop: { marginTop: tokens.space.md, gap: tokens.space.xs },
  dayTrack: {
    height: 36,
    backgroundColor: tokens.bg.elevated,
    borderRadius: tokens.radius.sm,
    overflow: "hidden",
  },
  hourLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: tokens.border.default,
  },
  sessionBand: {
    position: "absolute",
    top: 4,
    bottom: 4,
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: tokens.neon.pink,
    borderRadius: 2,
  },
  tick: {
    position: "absolute",
    top: 8,
    bottom: 8,
    width: 2,
    marginLeft: -1,
    backgroundColor: tokens.neon.yellow,
  },
  tickBackfill: { backgroundColor: tokens.text.secondary },
  hourLabels: { height: 16 },
  hourLabel: { position: "absolute", top: 0 },
  session: {
    marginTop: tokens.space.lg,
    gap: tokens.space.xs,
  },
  lane: {
    height: 22,
    backgroundColor: tokens.bg.elevated,
    borderRadius: tokens.radius.sm,
    overflow: "hidden",
    marginBottom: tokens.space.xs,
  },
  block: {
    position: "absolute",
    top: 3,
    bottom: 3,
    borderRadius: 2,
    borderRightWidth: 1,
    borderRightColor: tokens.bg.canvas,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: 3,
  },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  eventTime: { width: 62 },
});
