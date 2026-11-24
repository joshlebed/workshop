// Estimated time HighScore players spend playing, for the admin "Play time"
// tab (`GET /v1/admin/play-time`, `GET /v1/admin/play-time/:userId?day=`).
//
// We never see a game being played, only the moment its score is posted
// (`game_scores.created_at`), so time is inferred from those timestamps:
//
// - Posts by one player less than SESSION_GAP apart form a **session**: the
//   player sits down and works through their games, posting each as they go.
// - Inside a session, a post's play time is the **gap** since the previous
//   post (playing the game, plus reading the board and pasting).
// - The first post of a session has no previous post. It takes the game's
//   own time score when it is a time game under an hour (**timer**), else the
//   game's **typical** duration: the median in-session gap before that game
//   across every player in the window (DEFAULT_TYPICAL_SECONDS with fewer than
//   MIN_TYPICAL_SAMPLES).
// - A post for a puzzle day more than a day off the post's local date is a
//   **backfill** (an old share pasted late): shown, never counted, and it
//   doesn't start or extend a session.
//
// Local dates use the newest push token's timezone (period keys are the
// client's local date, so that is the day the player saw); users with no
// token fall back to DEFAULT_TIMEZONE and say so.

import type {
  AdminPlayEstimateSource,
  AdminPlayEvent,
  AdminPlaySession,
  AdminPlayTimeDay,
  AdminPlayTimeDayResponse,
  AdminPlayTimeResponse,
  AdminPlayTimeUser,
} from "@workshop/shared";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, games, pushTokens, users } from "../db/schema.js";

const SESSION_GAP_MINUTES = 20;
export const DEFAULT_TYPICAL_SECONDS = 120;
const MIN_TYPICAL_SAMPLES = 3;
const DEFAULT_TIMEZONE = "America/New_York";
export const PLAY_TIME_RANGES = [7, 30, 90] as const;
const TIMER_MAX_SECONDS = 3600;
const SESSION_GAP_MS = SESSION_GAP_MINUTES * 60_000;
const DAY_MS = 86_400_000;

export interface PlayRow {
  userId: string;
  gameId: string;
  gameTitle: string;
  createdAt: Date;
  periodKey: string;
  scoreValue: number | null;
  scoreUnit: string | null;
  summary: string | null;
  entrySource: string | null;
}

interface EstimatedPlay extends PlayRow {
  localDay: string;
  localMinute: number;
  /** Per-user session index; -1 for a backfill. */
  session: number;
  estimatedSeconds: number;
  source: AdminPlayEstimateSource;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Local `YYYY-MM-DD` and minutes since local midnight for an instant. */
function localParts(at: Date, timeZone: string): { day: string; minute: number } {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(at)) parts[p.type] = p.value;
  const minute = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function isBackfill(row: PlayRow, localDay: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(row.periodKey) && Math.abs(dayDiff(row.periodKey, localDay)) > 1
  );
}

/**
 * Median in-session gap before each game, across every player. `byUser` rows
 * must be sorted oldest first; backfills are skipped.
 */
export function typicalSecondsByGame(
  byUser: Map<string, PlayRow[]>,
  timezoneFor: (userId: string) => string,
): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const [userId, rows] of byUser) {
    const tz = timezoneFor(userId);
    let prev: PlayRow | null = null;
    for (const row of rows) {
      if (isBackfill(row, localParts(row.createdAt, tz).day)) continue;
      if (prev) {
        const gap = row.createdAt.getTime() - prev.createdAt.getTime();
        if (gap <= SESSION_GAP_MS) {
          const list = samples.get(row.gameId) ?? [];
          list.push(gap / 1000);
          samples.set(row.gameId, list);
        }
      }
      prev = row;
    }
  }
  const out = new Map<string, number>();
  for (const [gameId, list] of samples) {
    if (list.length >= MIN_TYPICAL_SAMPLES) out.set(gameId, Math.round(median(list)));
  }
  return out;
}

/** Annotate one player's posts (sorted oldest first) with sessions and estimates. */
export function estimatePlays(
  rows: PlayRow[],
  timeZone: string,
  typical: Map<string, number>,
): EstimatedPlay[] {
  const out: EstimatedPlay[] = [];
  let session = -1;
  let prev: PlayRow | null = null;
  for (const row of rows) {
    const { day, minute } = localParts(row.createdAt, timeZone);
    if (isBackfill(row, day)) {
      out.push({
        ...row,
        localDay: day,
        localMinute: minute,
        session: -1,
        estimatedSeconds: 0,
        source: "backfill",
      });
      continue;
    }
    const gap = prev
      ? row.createdAt.getTime() - prev.createdAt.getTime()
      : Number.POSITIVE_INFINITY;
    let estimatedSeconds: number;
    let source: AdminPlayEstimateSource;
    if (gap <= SESSION_GAP_MS) {
      estimatedSeconds = Math.round(gap / 1000);
      source = "gap";
    } else {
      session += 1;
      const timer =
        row.scoreUnit === "seconds" && row.scoreValue !== null && row.scoreValue > 0
          ? row.scoreValue
          : null;
      if (timer !== null && timer <= TIMER_MAX_SECONDS) {
        estimatedSeconds = Math.round(timer);
        source = "timer";
      } else {
        estimatedSeconds = typical.get(row.gameId) ?? DEFAULT_TYPICAL_SECONDS;
        source = "typical";
      }
    }
    out.push({ ...row, localDay: day, localMinute: minute, session, estimatedSeconds, source });
    prev = row;
  }
  return out;
}

/** Per-local-day totals; a session spanning midnight splits by post. */
export function summarizeDays(plays: EstimatedPlay[]): AdminPlayTimeDay[] {
  const days = new Map<string, { seconds: number; scores: number; sessions: Set<number> }>();
  for (const p of plays) {
    const d = days.get(p.localDay) ?? { seconds: 0, scores: 0, sessions: new Set<number>() };
    d.scores += 1;
    d.seconds += p.estimatedSeconds;
    if (p.session >= 0) d.sessions.add(p.session);
    days.set(p.localDay, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ day, seconds: d.seconds, scores: d.scores, sessions: d.sessions.size }));
}

/** The sessions with a post on `day`, clipped to that day's posts. */
export function sessionsForDay(plays: EstimatedPlay[], day: string): AdminPlaySession[] {
  const bySession = new Map<number, EstimatedPlay[]>();
  for (const p of plays) {
    if (p.localDay !== day || p.session < 0) continue;
    const list = bySession.get(p.session) ?? [];
    list.push(p);
    bySession.set(p.session, list);
  }
  return [...bySession.values()].map((list) => {
    const first = list[0] as EstimatedPlay;
    const last = list[list.length - 1] as EstimatedPlay;
    const seconds = list.reduce((sum, p) => sum + p.estimatedSeconds, 0);
    const startAt = new Date(first.createdAt.getTime() - first.estimatedSeconds * 1000);
    return {
      start: startAt.toISOString(),
      end: last.createdAt.toISOString(),
      startMinute: Math.max(0, first.localMinute - first.estimatedSeconds / 60),
      endMinute: last.localMinute,
      seconds,
      scores: list.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

interface Loaded {
  byUser: Map<string, PlayRow[]>;
  timezones: Map<string, string>;
  typical: Map<string, number>;
}

async function loadPlays(since: Date, until: Date, userId?: string): Promise<Loaded> {
  const db = getDb();
  // Typical durations always come from every player in the window, so a
  // single user's day estimates the same as the leaderboard does.
  const [scoreRows, tokenRows] = await Promise.all([
    db
      .select({
        userId: gameScores.userId,
        gameId: gameScores.gameId,
        gameTitle: games.title,
        createdAt: gameScores.createdAt,
        periodKey: gameScores.periodKey,
        scoreValue: gameScores.scoreValue,
        scoreUnit: games.scoreUnit,
        summary: gameScores.scoreSummary,
        entrySource: gameScores.entrySource,
      })
      .from(gameScores)
      .innerJoin(games, eq(games.id, gameScores.gameId))
      .where(and(gte(gameScores.createdAt, since), lt(gameScores.createdAt, until)))
      .orderBy(gameScores.createdAt),
    db
      .select({ userId: pushTokens.userId, timezone: pushTokens.timezone })
      .from(pushTokens)
      .where(userId ? eq(pushTokens.userId, userId) : undefined)
      .orderBy(desc(pushTokens.lastSeenAt)),
  ]);
  const timezones = new Map<string, string>();
  for (const t of tokenRows) {
    if (!timezones.has(t.userId) && isValidTimeZone(t.timezone))
      timezones.set(t.userId, t.timezone);
  }
  const byUser = new Map<string, PlayRow[]>();
  for (const r of scoreRows) {
    const list = byUser.get(r.userId) ?? [];
    list.push({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
      scoreValue: r.scoreValue === null ? null : Number(r.scoreValue),
    });
    byUser.set(r.userId, list);
  }
  // Token timezones for everyone else are only needed for the typical gaps'
  // backfill check; a day off there barely moves a median.
  const tz = (id: string) => timezones.get(id) ?? DEFAULT_TIMEZONE;
  return { byUser, timezones, typical: typicalSecondsByGame(byUser, tz) };
}

export async function buildAdminPlayTime(
  rangeDays: number,
  now = new Date(),
): Promise<AdminPlayTimeResponse> {
  const since = new Date(now.getTime() - rangeDays * DAY_MS);
  const { byUser, timezones, typical } = await loadPlays(since, now);
  const ids = [...byUser.keys()];
  const people =
    ids.length === 0
      ? []
      : await getDb()
          .select({ id: users.id, displayName: users.displayName, email: users.email })
          .from(users)
          .where(inArray(users.id, ids));
  const personById = new Map(people.map((p) => [p.id, p]));

  const out: AdminPlayTimeUser[] = [];
  for (const [userId, rows] of byUser) {
    const person = personById.get(userId);
    if (!person) continue;
    const timezone = timezones.get(userId) ?? DEFAULT_TIMEZONE;
    const days = summarizeDays(estimatePlays(rows, timezone, typical)).filter((d) => d.seconds > 0);
    if (days.length === 0) continue;
    const totalSeconds = days.reduce((s, d) => s + d.seconds, 0);
    out.push({
      id: userId,
      displayName: person.displayName,
      email: person.email,
      timezone,
      timezoneAssumed: !timezones.has(userId),
      activeDays: days.length,
      scores: days.reduce((s, d) => s + d.scores, 0),
      totalSeconds,
      avgSecondsPerActiveDay: Math.round(totalSeconds / days.length),
      days,
    });
  }
  out.sort((a, b) => b.totalSeconds - a.totalSeconds);
  return {
    generatedAt: now.toISOString(),
    rangeDays,
    sessionGapMinutes: SESSION_GAP_MINUTES,
    defaultTypicalSeconds: DEFAULT_TYPICAL_SECONDS,
    users: out,
  };
}

export async function buildAdminPlayTimeDay(
  userId: string,
  day: string,
  timezoneOverride?: string,
): Promise<AdminPlayTimeDayResponse | null> {
  const [person] = await getDb()
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!person) return null;
  // Typical durations from the 30 days around the day; ±2 days catches any
  // timezone and a session that started the evening before.
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const { byUser, timezones, typical } = await loadPlays(
    new Date(dayStart - 28 * DAY_MS),
    new Date(dayStart + 2 * DAY_MS),
  );
  const timezoneAssumed = !timezoneOverride && !timezones.has(userId);
  const timezone = timezoneOverride ?? timezones.get(userId) ?? DEFAULT_TIMEZONE;
  const plays = estimatePlays(byUser.get(userId) ?? [], timezone, typical);
  const sessions = sessionsForDay(plays, day);
  const sessionIndex = new Map<number, number>();
  for (const p of plays) {
    if (p.localDay === day && p.session >= 0 && !sessionIndex.has(p.session)) {
      sessionIndex.set(p.session, sessionIndex.size);
    }
  }
  const events: AdminPlayEvent[] = plays
    .filter((p) => p.localDay === day)
    .map((p) => ({
      at: p.createdAt.toISOString(),
      localMinute: p.localMinute,
      gameId: p.gameId,
      gameTitle: p.gameTitle,
      periodKey: p.periodKey,
      summary: p.summary,
      entrySource: p.entrySource,
      session: p.session < 0 ? -1 : (sessionIndex.get(p.session) ?? -1),
      estimatedSeconds: p.estimatedSeconds,
      source: p.source,
    }));
  return {
    userId,
    displayName: person.displayName,
    timezone,
    timezoneAssumed,
    day,
    seconds: events.reduce((s, e) => s + e.estimatedSeconds, 0),
    events,
    sessions,
  };
}
