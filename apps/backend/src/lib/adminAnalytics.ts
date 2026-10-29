// Numbers behind the per-app admin dashboards (`GET /v1/admin/analytics`).
//
// Everything is aggregated in JS from small day-grained result sets: the
// tables involved (`user_activity_days`, `game_scores`, `items`, `lists`) are
// tiny at this product's scale, and keeping the arithmetic here means the
// same code runs against Postgres in prod and PGlite in tests.
//
// Windows longer than ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE days are rolled up
// into 7-day buckets (the last bucket ends today). Distinct-user series stay
// distinct within a bucket (weekly active users, not a sum of dailies); the
// rolling MAU is the value on the bucket's last day; plain counts are summed.

import type {
  AdminAnalyticsPoint,
  AdminAnalyticsRange,
  AdminAnalyticsResponse,
  AdminAnalyticsSeries,
  AdminAnalyticsStat,
} from "@workshop/shared";
import {
  ADMIN_ANALYTICS_WEEKLY_BUCKET_ABOVE,
  type AdminAnalyticsBucket,
  type WorkshopClient,
} from "@workshop/shared/constants";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, items, lists, userActivityDays } from "../db/schema.js";
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

/** `(timestamp AT TIME ZONE 'UTC')::date` rendered as text, so it groups and compares as `YYYY-MM-DD`. */
function utcDayOf(column: unknown) {
  return sql<string>`to_char((${column} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`;
}

interface ActivityRow {
  userId: string;
  day: string;
}

/**
 * Active-user series for one client from `user_activity_days`: active users
 * per bucket, rolling-30-day actives (end-of-bucket snapshot), and first-seen
 * (new) users.
 */
async function activeUserSeries(db: Db, client: WorkshopClient, buckets: Bucket[]) {
  const days = buckets.flatMap((b) => b.days);
  const first = days[0] ?? utcDay(new Date());
  const last = days[days.length - 1] ?? first;
  const lookbackStart = addDays(first, -(MAU_WINDOW - 1));

  const rows: ActivityRow[] = await db
    .select({ userId: userActivityDays.userId, day: sql<string>`${userActivityDays.day}::text` })
    .from(userActivityDays)
    .where(and(eq(userActivityDays.client, client), gte(userActivityDays.day, lookbackStart)));
  const usersByDay = usersByDayOf(rows);

  const active = distinctSeries(buckets, usersByDay);
  const mau = buckets.map((b) => {
    const end = b.days[b.days.length - 1] ?? b.start;
    return {
      day: b.start,
      value: distinctOver(dayRange(addDays(end, -(MAU_WINDOW - 1)), end), usersByDay),
    };
  });

  // "New" = first day this user ever appeared for this client, computed over
  // the whole table (not just the window) so returning users never re-count.
  const firstDayByUser = new Map<string, string>();
  const allRows: ActivityRow[] = await db
    .select({
      userId: userActivityDays.userId,
      day: sql<string>`min(${userActivityDays.day})::text`,
    })
    .from(userActivityDays)
    .where(eq(userActivityDays.client, client))
    .groupBy(userActivityDays.userId);
  for (const row of allRows) firstDayByUser.set(row.userId, row.day);
  const newByDay = new Map<string, number>();
  for (const day of firstDayByUser.values()) newByDay.set(day, (newByDay.get(day) ?? 0) + 1);

  const activeWithin = (n: number) =>
    distinctOver(dayRange(addDays(last, -(n - 1)), last), usersByDay);

  return {
    active,
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
      scores: sql<number>`count(*)`,
    })
    .from(gameScores)
    .where(gte(gameScores.createdAt, sinceTs))
    .groupBy(createdDay, gameScores.userId);
  const scoresByDay = new Map<string, number>();
  for (const r of rows) scoresByDay.set(r.day, (scoresByDay.get(r.day) ?? 0) + Number(r.scores));
  return {
    scores: sumSeries(buckets, scoresByDay),
    scorers: distinctSeries(buckets, usersByDayOf(rows)),
  };
}

async function workshopSeries(db: Db, buckets: Bucket[]) {
  const first = buckets[0]?.start ?? utcDay(new Date());
  const sinceTs = new Date(`${first}T00:00:00Z`);
  const itemDay = utcDayOf(items.createdAt);
  const itemRows = await db
    .select({ day: itemDay, count: sql<number>`count(*)` })
    .from(items)
    .where(and(gte(items.createdAt, sinceTs), isNull(items.archivedAt)))
    .groupBy(itemDay);
  const listDay = utcDayOf(lists.createdAt);
  const listRows = await db
    .select({ day: listDay, count: sql<number>`count(*)` })
    .from(lists)
    .where(and(gte(lists.createdAt, sinceTs), isNull(lists.archivedAt)))
    .groupBy(listDay);
  return {
    items: sumSeries(buckets, countByDay(itemRows)),
    lists: sumSeries(buckets, countByDay(listRows)),
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

  const stats: AdminAnalyticsStat[] = [
    { key: "active_today", label: "Active today", value: active.activeToday },
    { key: "active_7d", label: "Active last 7 days", value: active.active7 },
    { key: "active_30d", label: "Active last 30 days", value: active.active30 },
    { key: "users_total", label: "Users ever seen", value: active.totalUsers },
  ];
  const series: AdminAnalyticsSeries[] = [
    bucket === "week"
      ? {
          key: "dau",
          label: "Weekly active users",
          description:
            "Distinct signed-in users who made at least one request from this app during that week.",
          points: active.active,
        }
      : {
          key: "dau",
          label: "Daily active users",
          description:
            "Distinct signed-in users who made at least one request from this app that UTC day.",
          points: active.active,
        },
    {
      key: "mau",
      label: "Monthly active users",
      description: `Distinct users active in the 30 days ending on each ${per} (rolling).`,
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
        description: `Game scores first posted that ${per} (edits to an existing day's score don't count again).`,
        points: hs.scores,
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
        description: `Items created that ${per} across all lists (archived items excluded).`,
        points: ws.items,
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
    description: `Users whose first-ever activity in this app fell in that ${per}.`,
    points: active.newUsers,
  });

  return { client, rangeDays, bucket, generatedAt: now.toISOString(), stats, series };
}
