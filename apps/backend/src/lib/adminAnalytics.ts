// Numbers behind the per-app admin dashboards (`GET /v1/admin/analytics`).
//
// Everything is aggregated in JS from small day-grained result sets: the
// tables involved (`user_activity_days`, `game_scores`, `items`, `lists`) are
// tiny at this product's scale, and keeping the arithmetic here means the
// same code runs against Postgres in prod and PGlite in tests.

import type {
  AdminAnalyticsPoint,
  AdminAnalyticsRange,
  AdminAnalyticsResponse,
  AdminAnalyticsSeries,
  AdminAnalyticsStat,
} from "@workshop/shared";
import type { WorkshopClient } from "@workshop/shared/constants";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, items, lists, userActivityDays } from "../db/schema.js";
import { utcDay } from "./userActivity.js";

const MAU_WINDOW = 30;
const DAY_MS = 86_400_000;

type Db = ReturnType<typeof getDb>;

function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS));
}

/** Every UTC day from `start` to `end` inclusive. */
function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function fillSeries(days: string[], byDay: Map<string, number>): AdminAnalyticsPoint[] {
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

function countByDay(rows: { day: string; count: number | string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.day, Number(row.count));
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
 * Active-user series for one client from `user_activity_days`:
 * daily actives, rolling-30-day actives, and first-seen (new) users.
 */
async function activeUserSeries(db: Db, client: WorkshopClient, days: string[]) {
  const first = days[0] ?? utcDay(new Date());
  const last = days[days.length - 1] ?? first;
  const lookbackStart = addDays(first, -(MAU_WINDOW - 1));

  const rows: ActivityRow[] = await db
    .select({ userId: userActivityDays.userId, day: sql<string>`${userActivityDays.day}::text` })
    .from(userActivityDays)
    .where(and(eq(userActivityDays.client, client), gte(userActivityDays.day, lookbackStart)));

  // Everything the chart needs about "who was active when", in memory.
  const usersByDay = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = usersByDay.get(row.day);
    if (!set) {
      set = new Set();
      usersByDay.set(row.day, set);
    }
    set.add(row.userId);
  }

  const dau = days.map((day) => ({ day, value: usersByDay.get(day)?.size ?? 0 }));
  const mau = days.map((day) => {
    const seen = new Set<string>();
    for (const d of dayRange(addDays(day, -(MAU_WINDOW - 1)), day)) {
      for (const u of usersByDay.get(d) ?? []) seen.add(u);
    }
    return { day, value: seen.size };
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

  const activeWithin = (n: number) => {
    const seen = new Set<string>();
    for (const d of dayRange(addDays(last, -(n - 1)), last)) {
      for (const u of usersByDay.get(d) ?? []) seen.add(u);
    }
    return seen.size;
  };

  return {
    dau,
    mau,
    newUsers: fillSeries(days, newByDay),
    activeToday: usersByDay.get(last)?.size ?? 0,
    active7: activeWithin(7),
    active30: activeWithin(30),
    totalUsers: firstDayByUser.size,
  };
}

async function highscoreSeries(db: Db, days: string[]) {
  const first = days[0] ?? utcDay(new Date());
  const sinceTs = new Date(`${first}T00:00:00Z`);
  const createdDay = utcDayOf(gameScores.createdAt);
  const rows = await db
    .select({
      day: createdDay,
      scores: sql<number>`count(*)`,
      scorers: sql<number>`count(distinct ${gameScores.userId})`,
    })
    .from(gameScores)
    .where(gte(gameScores.createdAt, sinceTs))
    .groupBy(createdDay);
  const scores = countByDay(rows.map((r) => ({ day: r.day, count: r.scores })));
  const scorers = countByDay(rows.map((r) => ({ day: r.day, count: r.scorers })));
  return { scores: fillSeries(days, scores), scorers: fillSeries(days, scorers) };
}

async function workshopSeries(db: Db, days: string[]) {
  const first = days[0] ?? utcDay(new Date());
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
    items: fillSeries(days, countByDay(itemRows)),
    lists: fillSeries(days, countByDay(listRows)),
  };
}

function sum(points: AdminAnalyticsPoint[], lastN: number): number {
  return points.slice(-lastN).reduce((acc, p) => acc + p.value, 0);
}

export async function buildAdminAnalytics(
  client: WorkshopClient,
  rangeDays: AdminAnalyticsRange,
  now = new Date(),
): Promise<AdminAnalyticsResponse> {
  const db = getDb();
  const today = utcDay(now);
  const days = dayRange(addDays(today, -(rangeDays - 1)), today);
  const active = await activeUserSeries(db, client, days);

  const stats: AdminAnalyticsStat[] = [
    { key: "active_today", label: "Active today", value: active.activeToday },
    { key: "active_7d", label: "Active last 7 days", value: active.active7 },
    { key: "active_30d", label: "Active last 30 days", value: active.active30 },
    { key: "users_total", label: "Users ever seen", value: active.totalUsers },
  ];
  const series: AdminAnalyticsSeries[] = [
    {
      key: "dau",
      label: "Daily active users",
      description:
        "Distinct signed-in users who made at least one request from this app that UTC day.",
      points: active.dau,
    },
    {
      key: "mau",
      label: "Monthly active users",
      description: "Distinct users active in the 30 days ending on each day (rolling).",
      points: active.mau,
    },
  ];

  if (client === "highscore") {
    const hs = await highscoreSeries(db, days);
    stats.push({ key: "scores_7d", label: "Scores posted, last 7 days", value: sum(hs.scores, 7) });
    series.push(
      {
        key: "scores",
        label: "Scores posted per day",
        description:
          "Game scores first posted that UTC day (edits to an existing day's score don't count again).",
        points: hs.scores,
      },
      {
        key: "scorers",
        label: "Players posting a score",
        description: "Distinct users who posted at least one score that UTC day.",
        points: hs.scorers,
      },
    );
  } else {
    const ws = await workshopSeries(db, days);
    stats.push({ key: "items_7d", label: "Items added, last 7 days", value: sum(ws.items, 7) });
    series.push(
      {
        key: "items",
        label: "Items added per day",
        description: "Items created that UTC day across all lists (archived items excluded).",
        points: ws.items,
      },
      {
        key: "lists",
        label: "Lists created per day",
        description: "Lists created that UTC day (archived lists excluded).",
        points: ws.lists,
      },
    );
  }

  series.push({
    key: "new_users",
    label: "New users per day",
    description: "Users whose first-ever activity in this app fell on that UTC day.",
    points: active.newUsers,
  });

  return { client, rangeDays, generatedAt: now.toISOString(), stats, series };
}
