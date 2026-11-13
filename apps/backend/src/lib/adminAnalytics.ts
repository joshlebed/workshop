// Numbers behind the per-app admin dashboards (`GET /v1/admin/analytics`).
//
// Everything is aggregated in JS from small day-grained result sets: the
// tables involved (`game_scores`, `items`, `lists`, `friendships`, …) are
// tiny at this product's scale, and keeping the arithmetic here means the
// same code runs against Postgres in prod and PGlite in tests.
//
// "Active" means the user took an action that day (see `actionRows`), not
// that the app made a request — a background refresh is not activity, and a
// user is one user however many platforms they used.
//
// Windows longer than ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE days are rolled up
// into 7-day buckets (the last bucket ends today). Distinct-user series stay
// distinct within a bucket (weekly active users, not a sum of dailies); the
// rolling MAU is the value on the bucket's last day; plain counts are summed.

import type {
  AdminAnalyticsBreakdown,
  AdminAnalyticsPoint,
  AdminAnalyticsRange,
  AdminAnalyticsResponse,
  AdminAnalyticsSegment,
  AdminAnalyticsSeries,
  AdminAnalyticsStat,
  AdminAnalyticsVersionSegment,
} from "@workshop/shared";
import {
  ADMIN_ANALYTICS_PLATFORMS,
  ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE,
  type AdminAnalyticsBucket,
  type AdminAnalyticsPlatform,
  type WorkshopClient,
} from "@workshop/shared/constants";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  activityEvents,
  friendships,
  gameNudges,
  gameScoreReactions,
  gameScores,
  items,
  lists,
  requestRollups,
  userActivityDays,
  userGames,
} from "../db/schema.js";
import { utcDay } from "./userActivity.js";

const MAU_WINDOW = 30;
const DAY_MS = 86_400_000;

type Db = ReturnType<typeof getDb>;

/** A run of consecutive UTC days charted as one bar; `start` labels it. */
interface Bucket {
  start: string;
  days: string[];
}

function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

/** Every UTC day from `start` to `end` inclusive. */
function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Split `days` into buckets of `size`, aligned so the last bucket ends on the last day. */
function bucketDays(days: string[], size: number): Bucket[] {
  const out: Bucket[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const slice = days.slice(Math.max(0, end - size), end);
    const start = slice[0];
    if (start) out.unshift({ start, days: slice });
  }
  return out;
}

/** Sum a per-day count over each bucket. */
function sumSeries(buckets: Bucket[], byDay: Map<string, number>): AdminAnalyticsPoint[] {
  return buckets.map((b) => ({
    day: b.start,
    value: b.days.reduce((acc, d) => acc + (byDay.get(d) ?? 0), 0),
  }));
}

/** Count users seen on any day of each bucket (distinct within the bucket). */
function distinctSeries(
  buckets: Bucket[],
  usersByDay: Map<string, Set<string>>,
): AdminAnalyticsPoint[] {
  return buckets.map((b) => ({ day: b.start, value: distinctOver(b.days, usersByDay) }));
}

function distinctOver(days: string[], usersByDay: Map<string, Set<string>>): number {
  if (days.length === 1) return usersByDay.get(days[0] ?? "")?.size ?? 0;
  const seen = new Set<string>();
  for (const d of days) for (const u of usersByDay.get(d) ?? []) seen.add(u);
  return seen.size;
}

function countByDay(rows: { day: string; count: number | string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.day, Number(row.count));
  return out;
}

function usersByDayOf(rows: { userId: string; day: string }[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = out.get(row.day);
    if (!set) {
      set = new Set();
      out.set(row.day, set);
    }
    set.add(row.userId);
  }
  return out;
}

const PLATFORM_LABELS: Record<AdminAnalyticsPlatform, string> = {
  ios: "iOS app",
  web: "Web",
  other: "Other / unknown",
};

/** Fold the raw `X-Workshop-Platform` value onto the fixed chart segments. */
function platformSegment(raw: string | null | undefined): AdminAnalyticsPlatform {
  const p = raw?.toLowerCase();
  if (p === "ios") return "ios";
  if (p === "web") return "web";
  return "other";
}

/** Partition rows by platform segment (fixed order), dropping empty segments. */
function byPlatform<T extends { platform: string | null }>(rows: T[]) {
  const groups = new Map<AdminAnalyticsPlatform, T[]>();
  for (const row of rows) {
    const seg = platformSegment(row.platform);
    const list = groups.get(seg);
    if (list) list.push(row);
    else groups.set(seg, [row]);
  }
  return ADMIN_ANALYTICS_PLATFORMS.flatMap((seg) => {
    const list = groups.get(seg);
    return list ? [{ seg, label: PLATFORM_LABELS[seg], rows: list }] : [];
  });
}

function stackOf(
  groups: { seg: AdminAnalyticsPlatform; label: string; points: AdminAnalyticsPoint[] }[],
): AdminAnalyticsSegment[] {
  return groups.map((g) => ({ key: g.seg, label: g.label, points: g.points }));
}

/** `(timestamp AT TIME ZONE 'UTC')::date` rendered as text, so it groups and compares as `YYYY-MM-DD`. */
function utcDayOf(column: unknown) {
  return sql<string>`to_char((${column} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`;
}

interface ActivityRow {
  userId: string;
  day: string;
  platform: string;
  appVersion: string;
}

/** A (user, UTC day) pair: the user did something that counts on that day. */
interface ActionRow {
  userId: string;
  day: string;
}

/**
 * Every (user, day) on which the user *did something* in this app — the
 * definition of "active" for every active-user number on the dashboard.
 * Merely opening the app (any request, a background refresh, a poll) is not
 * an action; `user_activity_days` records that and is only used for the
 * version-adoption chart.
 *
 * HighScore: posted a score, added a game, reacted to a score, or made a
 * friend. Workshop: added an item, created a list, any activity-feed event
 * (edits, checks, joins, …), or made a friend. Friendships are app-agnostic
 * (both apps have the surface and the row carries no client), so a new
 * friendship counts both users as active in both apps that day.
 *
 * All time: MAU needs a 30-day lookback and "new" / "ever" need the whole
 * history. The tables are small at this scale.
 */
async function actionRows(db: Db, client: WorkshopClient): Promise<ActionRow[]> {
  const out: ActionRow[] = [];
  const push = (rows: ActionRow[]) => {
    for (const r of rows) out.push(r);
  };

  const friendRows = await db
    .select({
      userLow: friendships.userLow,
      userHigh: friendships.userHigh,
      day: utcDayOf(friendships.createdAt),
    })
    .from(friendships);
  for (const r of friendRows) {
    out.push({ userId: r.userLow, day: r.day }, { userId: r.userHigh, day: r.day });
  }

  if (client === "highscore") {
    push(
      await db
        .select({ userId: gameScores.userId, day: utcDayOf(gameScores.createdAt) })
        .from(gameScores)
        .groupBy(gameScores.userId, utcDayOf(gameScores.createdAt)),
    );
    push(
      await db
        .select({ userId: userGames.userId, day: utcDayOf(userGames.addedAt) })
        .from(userGames)
        .groupBy(userGames.userId, utcDayOf(userGames.addedAt)),
    );
    push(
      await db
        .select({
          userId: gameScoreReactions.reactorUserId,
          day: utcDayOf(gameScoreReactions.createdAt),
        })
        .from(gameScoreReactions)
        .groupBy(gameScoreReactions.reactorUserId, utcDayOf(gameScoreReactions.createdAt)),
    );
    push(
      await db
        .select({ userId: gameNudges.senderId, day: utcDayOf(gameNudges.createdAt) })
        .from(gameNudges)
        .groupBy(gameNudges.senderId, utcDayOf(gameNudges.createdAt)),
    );
  } else {
    push(
      await db
        .select({ userId: items.addedBy, day: utcDayOf(items.createdAt) })
        .from(items)
        .groupBy(items.addedBy, utcDayOf(items.createdAt)),
    );
    push(
      await db
        .select({ userId: lists.ownerId, day: utcDayOf(lists.createdAt) })
        .from(lists)
        .groupBy(lists.ownerId, utcDayOf(lists.createdAt)),
    );
    push(
      await db
        .select({ userId: activityEvents.actorId, day: utcDayOf(activityEvents.createdAt) })
        .from(activityEvents)
        .groupBy(activityEvents.actorId, utcDayOf(activityEvents.createdAt)),
    );
  }
  return out;
}

/** Dotted-numeric comparison (`1.10.0` > `1.9.2`); anything non-numeric sorts lowest. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : null);
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : a.localeCompare(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Bands the adoption chart draws before folding the rest into "Other versions". */
const MAX_VERSION_SEGMENTS = 7;

/**
 * One band per (platform, version), aligned with `buckets`, in stack order:
 * platform (fixed order), then version ascending, so newer versions sit on
 * top of the ones they replace. The smallest bands past
 * `MAX_VERSION_SEGMENTS` fold into one "Other versions" band.
 */
function versionAdoptionSegments(
  buckets: Bucket[],
  rows: ActivityRow[],
): AdminAnalyticsVersionSegment[] {
  const bucketOfDay = new Map<string, number>();
  buckets.forEach((b, i) => {
    for (const d of b.days) bucketOfDay.set(d, i);
  });
  // (bucket, user, platform) -> highest version seen.
  const latest = new Map<
    string,
    { bucket: number; platform: AdminAnalyticsPlatform; version: string }
  >();
  for (const row of rows) {
    const bucket = bucketOfDay.get(row.day);
    if (bucket === undefined) continue;
    const platform = platformSegment(row.platform);
    const key = `${bucket}\u0000${row.userId}\u0000${platform}`;
    const prev = latest.get(key);
    if (!prev || compareVersions(row.appVersion, prev.version) > 0) {
      latest.set(key, { bucket, platform, version: row.appVersion });
    }
  }
  const bands = new Map<
    string,
    { platform: AdminAnalyticsPlatform; version: string; counts: number[]; total: number }
  >();
  for (const entry of latest.values()) {
    const key = `${entry.platform}:${entry.version}`;
    let band = bands.get(key);
    if (!band) {
      band = {
        platform: entry.platform,
        version: entry.version,
        counts: buckets.map(() => 0),
        total: 0,
      };
      bands.set(key, band);
    }
    band.counts[entry.bucket] = (band.counts[entry.bucket] ?? 0) + 1;
    band.total += 1;
  }
  const ranked = [...bands.entries()].sort(
    (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]),
  );
  const kept = ranked.slice(0, MAX_VERSION_SEGMENTS);
  const folded = ranked.slice(MAX_VERSION_SEGMENTS);
  const points = (counts: number[]) =>
    buckets.map((b, i) => ({ day: b.start, value: counts[i] ?? 0 }));
  const out: AdminAnalyticsVersionSegment[] = kept
    .sort(
      (a, b) =>
        ADMIN_ANALYTICS_PLATFORMS.indexOf(a[1].platform) -
          ADMIN_ANALYTICS_PLATFORMS.indexOf(b[1].platform) ||
        compareVersions(a[1].version, b[1].version),
    )
    .map(([key, band]) => ({
      key,
      // Requests from before the app sent its platform and version headers.
      label:
        band.platform === "other" && band.version === "unknown"
          ? "Unknown version"
          : `${PLATFORM_LABELS[band.platform]} · ${band.version}`,
      platform: band.platform,
      points: points(band.counts),
    }));
  if (folded.length > 0) {
    out.push({
      key: "other-versions",
      label: "Other versions",
      platform: "other",
      points: points(
        buckets.map((_, i) => folded.reduce((acc, [, b]) => acc + (b.counts[i] ?? 0), 0)),
      ),
    });
  }
  return out;
}

/**
 * Active-user series for one client: users who took an action per bucket,
 * rolling-30-day actives (end-of-bucket snapshot), and first-seen (new)
 * users — all from `actionRows`, each user counted once per day no matter
 * how many actions or platforms. The version-adoption chart is the one
 * number still read from `user_activity_days` (it is the only place the app
 * version is recorded).
 */
async function activeUserSeries(db: Db, client: WorkshopClient, buckets: Bucket[]) {
  const days = buckets.flatMap((b) => b.days);
  const first = days[0] ?? utcDay(new Date());
  const last = days[days.length - 1] ?? first;

  const actions = await actionRows(db, client);
  const usersByDay = usersByDayOf(actions);

  const active = distinctSeries(buckets, usersByDay);
  const mau = buckets.map((b) => {
    const end = b.days[b.days.length - 1] ?? b.start;
    return {
      day: b.start,
      value: distinctOver(dayRange(addDays(end, -(MAU_WINDOW - 1)), end), usersByDay),
    };
  });

  // "New" = first day this user ever took an action in this app, computed
  // over the whole history so returning users never re-count.
  const firstDayByUser = new Map<string, string>();
  for (const row of actions) {
    const prev = firstDayByUser.get(row.userId);
    if (!prev || row.day < prev) firstDayByUser.set(row.userId, row.day);
  }
  const newByDay = new Map<string, number>();
  for (const day of firstDayByUser.values()) newByDay.set(day, (newByDay.get(day) ?? 0) + 1);

  const activeWithin = (n: number) =>
    distinctOver(dayRange(addDays(last, -(n - 1)), last), usersByDay);

  // Version adoption: distinct users per (platform, version) per bucket. A
  // user is counted once per platform per bucket, on the highest version they
  // were seen on, so an update moves them between bands instead of counting
  // them in both.
  const rows: ActivityRow[] = await db
    .select({
      userId: userActivityDays.userId,
      day: sql<string>`${userActivityDays.day}::text`,
      platform: userActivityDays.platform,
      appVersion: userActivityDays.appVersion,
    })
    .from(userActivityDays)
    .where(and(eq(userActivityDays.client, client), gte(userActivityDays.day, first)));
  const versions = versionAdoptionSegments(buckets, rows);

  return {
    active,
    versions,
    mau,
    newUsers: sumSeries(buckets, newByDay),
    activeToday: usersByDay.get(last)?.size ?? 0,
    active7: activeWithin(7),
    active30: activeWithin(30),
    totalUsers: firstDayByUser.size,
  };
}

async function highscoreSeries(db: Db, buckets: Bucket[]) {
  const first = buckets[0]?.start ?? utcDay(new Date());
  const sinceTs = new Date(`${first}T00:00:00Z`);
  const createdDay = utcDayOf(gameScores.createdAt);
  // (day, user) pairs rather than per-day counts so a weekly bucket can count
  // distinct scorers across the week.
  const rows = await db
    .select({
      day: createdDay,
      userId: gameScores.userId,
      platform: gameScores.platform,
      scores: sql<number>`count(*)`,
    })
    .from(gameScores)
    .where(gte(gameScores.createdAt, sinceTs))
    .groupBy(createdDay, gameScores.userId, gameScores.platform);
  const scoreCounts = (list: typeof rows) => {
    const byDay = new Map<string, number>();
    for (const r of list) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.scores));
    return sumSeries(buckets, byDay);
  };
  return {
    scores: scoreCounts(rows),
    scoresStack: stackOf(
      byPlatform(rows).map((g) => ({ seg: g.seg, label: g.label, points: scoreCounts(g.rows) })),
    ),
    scorers: distinctSeries(buckets, usersByDayOf(rows)),
  };
}

async function workshopSeries(db: Db, buckets: Bucket[]) {
  const first = buckets[0]?.start ?? utcDay(new Date());
  const sinceTs = new Date(`${first}T00:00:00Z`);
  const itemDay = utcDayOf(items.createdAt);
  const itemRows = await db
    .select({ day: itemDay, platform: items.platform, count: sql<number>`count(*)` })
    .from(items)
    .where(and(gte(items.createdAt, sinceTs), isNull(items.archivedAt)))
    .groupBy(itemDay, items.platform);
  const itemCounts = (list: typeof itemRows) => {
    const byDay = new Map<string, number>();
    for (const r of list) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.count));
    return sumSeries(buckets, byDay);
  };
  const listDay = utcDayOf(lists.createdAt);
  const listRows = await db
    .select({ day: listDay, count: sql<number>`count(*)` })
    .from(lists)
    .where(and(gte(lists.createdAt, sinceTs), isNull(lists.archivedAt)))
    .groupBy(listDay);
  return {
    items: itemCounts(itemRows),
    itemsStack: stackOf(
      byPlatform(itemRows).map((g) => ({ seg: g.seg, label: g.label, points: itemCounts(g.rows) })),
    ),
    lists: sumSeries(buckets, countByDay(listRows)),
  };
}

const CLIENT_LABELS: Record<string, string> = {
  workshop: "Workshop",
  highscore: "HighScore",
  unknown: "(no header)",
};
const SHORT_PLATFORM: Record<AdminAnalyticsPlatform, string> = {
  ios: "iOS",
  web: "web",
  other: "other",
};

/**
 * Request traffic from `request_rollups` — a backend-wide fact (both apps
 * share one API), so it is not filtered by client; the client split is a
 * breakdown instead. Everything is summed from hourly rows in JS.
 */
async function requestSeries(db: Db, buckets: Bucket[], last: string) {
  const first = buckets[0]?.start ?? utcDay(new Date());
  const sinceTs = new Date(`${first}T00:00:00Z`);
  const rows = await db
    .select({
      hour: requestRollups.hour,
      client: requestRollups.client,
      platform: requestRollups.platform,
      appVersion: requestRollups.appVersion,
      method: requestRollups.method,
      route: requestRollups.route,
      requests: requestRollups.requests,
      errors: requestRollups.errors,
    })
    .from(requestRollups)
    .where(gte(requestRollups.hour, sinceTs));
  const dayOf = (hour: Date) => utcDay(hour);
  const counts = (list: typeof rows) => {
    const byDay = new Map<string, number>();
    for (const r of list) byDay.set(dayOf(r.hour), (byDay.get(dayOf(r.hour)) ?? 0) + r.requests);
    return sumSeries(buckets, byDay);
  };
  const [through] = await db
    .select({ max: sql<string | null>`max(${requestRollups.hour})` })
    .from(requestRollups);

  const last24 = new Date(Date.parse(`${last}T00:00:00Z`) + DAY_MS - 24 * 3_600_000);
  const recent = rows.filter((r) => r.hour >= last24);
  const sevenDays = new Date(Date.parse(`${last}T00:00:00Z`) - 6 * DAY_MS);
  const week = rows.filter((r) => r.hour >= sevenDays);
  const tally = <K extends string>(list: typeof rows, keyOf: (r: (typeof rows)[number]) => K) => {
    const out = new Map<K, number>();
    for (const r of list) out.set(keyOf(r), (out.get(keyOf(r)) ?? 0) + r.requests);
    return out;
  };

  const versionLabel = (r: (typeof rows)[number]) =>
    `${CLIENT_LABELS[r.client] ?? r.client} · ${SHORT_PLATFORM[platformSegment(r.platform)]} · ${r.appVersion}`;
  const byClientVersion = tally(week, versionLabel);
  const platformOfLabel = new Map<string, AdminAnalyticsPlatform>();
  for (const r of week) platformOfLabel.set(versionLabel(r), platformSegment(r.platform));
  const byRoute = tally(week, (r) => `${r.method} ${r.route}`);
  const topN = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

  return {
    requests: counts(rows),
    requestsStack: stackOf(
      byPlatform(rows).map((g) => ({ seg: g.seg, label: g.label, points: counts(g.rows) })),
    ),
    requests24h: recent.reduce((a, r) => a + r.requests, 0),
    errors24h: recent.reduce((a, r) => a + r.errors, 0),
    versions: topN(byClientVersion, 12).map(([label, value]) => ({
      label,
      value,
      platform: platformOfLabel.get(label) ?? ("other" as const),
    })),
    routes: topN(byRoute, 10).map(([label, value]) => ({ label, value })),
    through: through?.max ? new Date(through.max).toISOString() : null,
  };
}

/** Sum of the last `lastDays` days of a daily count map. */
function sumLast(
  byDayPoints: AdminAnalyticsPoint[],
  lastDays: number,
  bucket: AdminAnalyticsBucket,
) {
  // Weekly buckets: the last bucket is the last 7 days by construction.
  const n = bucket === "week" ? Math.ceil(lastDays / 7) : lastDays;
  return byDayPoints.slice(-n).reduce((acc, p) => acc + p.value, 0);
}

function bucketFor(rangeDays: number): AdminAnalyticsBucket {
  return rangeDays > ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE ? "week" : "day";
}

export async function buildAdminAnalytics(
  client: WorkshopClient,
  rangeDays: AdminAnalyticsRange,
  now = new Date(),
): Promise<AdminAnalyticsResponse> {
  const db = getDb();
  const today = utcDay(now);
  const days = dayRange(addDays(today, -(rangeDays - 1)), today);
  const bucket = bucketFor(rangeDays);
  const buckets = bucketDays(days, bucket === "week" ? 7 : 1);
  const per = bucket === "week" ? "week" : "day";
  const active = await activeUserSeries(db, client, buckets);

  const actionsNoun =
    client === "highscore"
      ? "posted a score, added a game, reacted, or made a friend"
      : "added an item, created a list, edited a list, or made a friend";
  const stats: AdminAnalyticsStat[] = [
    { key: "active_today", label: "Active today", value: active.activeToday },
    { key: "active_7d", label: "Active last 7 days", value: active.active7 },
    { key: "active_30d", label: "Active last 30 days", value: active.active30 },
    { key: "users_total", label: "Users ever active", value: active.totalUsers },
  ];
  const series: AdminAnalyticsSeries[] = [
    {
      key: "dau",
      label: bucket === "week" ? "Weekly active users" : "Daily active users",
      description: `Distinct users who ${actionsNoun} ${
        bucket === "week" ? "during that week" : "that UTC day"
      }. Each person counts once, however many actions or devices. Opening the app without doing anything doesn't count.`,
      points: active.active,
    },
    {
      key: "mau",
      label: "Monthly active users",
      description: `Distinct users who took an action in the 30 days ending on each ${per} (rolling).`,
      points: active.mau,
    },
  ];

  if (client === "highscore") {
    const hs = await highscoreSeries(db, buckets);
    stats.push({
      key: "scores_7d",
      label: "Scores posted, last 7 days",
      value: sumLast(hs.scores, 7, bucket),
    });
    series.push(
      {
        key: "scores",
        label: `Scores posted per ${per}`,
        description: `Game scores first posted that ${per}, by the platform they were posted from (edits to an existing day's score don't count again).`,
        points: hs.scores,
        stack: hs.scoresStack,
        stackMode: "sum",
      },
      {
        key: "scorers",
        label: "Players posting a score",
        description: `Distinct users who posted at least one score that ${per}.`,
        points: hs.scorers,
      },
    );
  } else {
    const ws = await workshopSeries(db, buckets);
    stats.push({
      key: "items_7d",
      label: "Items added, last 7 days",
      value: sumLast(ws.items, 7, bucket),
    });
    series.push(
      {
        key: "items",
        label: `Items added per ${per}`,
        description: `Items created that ${per} across all lists, by the platform they were added from (archived items excluded).`,
        points: ws.items,
        stack: ws.itemsStack,
        stackMode: "sum",
      },
      {
        key: "lists",
        label: `Lists created per ${per}`,
        description: `Lists created that ${per} (archived lists excluded).`,
        points: ws.lists,
      },
    );
  }

  series.push({
    key: "new_users",
    label: `New users per ${per}`,
    description: `Users whose first-ever action in this app fell in that ${per}.`,
    points: active.newUsers,
  });

  const req = await requestSeries(db, buckets, days[days.length - 1] ?? today);
  stats.push(
    { key: "requests_24h", label: "API requests, last 24h", value: req.requests24h },
    { key: "errors_24h", label: "5xx responses, last 24h", value: req.errors24h },
  );
  series.push({
    key: "requests",
    label: `API requests per ${per}`,
    description: `Every request to the shared backend from any app or bot, by platform header (hourly rollups from the request log; not filtered by app).`,
    points: req.requests,
    stack: req.requestsStack,
    stackMode: "sum",
  });

  const breakdowns: AdminAnalyticsBreakdown[] = [
    {
      key: "request_versions",
      label: "API requests by app and version, last 7 days",
      description:
        "Request volume per client app, platform and version. '(no header)' is traffic from bots, scripts, and installs that predate the client header.",
      rows: req.versions,
    },
    {
      key: "routes",
      label: "Top routes, last 7 days",
      description: "Most-requested API routes across both apps.",
      rows: req.routes,
    },
  ];

  return {
    client,
    rangeDays,
    bucket,
    generatedAt: now.toISOString(),
    stats,
    series,
    breakdowns,
    versionAdoption: {
      label: `Versions in use per ${per}`,
      description: `Distinct users on each platform and app version per ${per}, from any request the app made (not only actions). Someone who updates counts on the newer version; someone on iOS and web counts once in each. The iOS version is the JS bundle version (follows OTA updates); web is the deployed build.`,
      segments: active.versions,
    },
    requestsThrough: req.through,
  };
}
