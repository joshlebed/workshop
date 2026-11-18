// Everything the head-to-head screen derives from `GET …/head-to-head`:
// totals, the headline, streaks, and the "who's ahead" series. Pure, so the
// screen only lays things out. Who won a day is the server's call
// (`apps/backend/src/lib/headToHead.ts`); nothing here re-judges a score.

import type {
  HeadToHeadDay,
  HeadToHeadGame,
  HeadToHeadOutcome,
  HeadToHeadRange,
} from "@workshop/shared/friends";

export const RANGE_OPTIONS: { range: HeadToHeadRange; label: string }[] = [
  { range: "7", label: "7 days" },
  { range: "30", label: "30 days" },
  { range: "all", label: "All time" },
];

export interface WinRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface Totals extends WinRecord {
  sharedDays: number;
}

export function totals(games: readonly HeadToHeadGame[]): Totals {
  const t: Totals = { wins: 0, losses: 0, ties: 0, sharedDays: 0 };
  for (const g of games) {
    t.wins += g.wins;
    t.losses += g.losses;
    t.ties += g.ties;
    t.sharedDays += g.sharedDays;
  }
  return t;
}

/** Wins as a whole percent of decided days (ties count as played); null with none. */
export function winPercent(r: WinRecord): number | null {
  const decided = r.wins + r.losses + r.ties;
  return decided === 0 ? null : Math.round((r.wins / decided) * 100);
}

/**
 * The name to use in a label: the first word of the display name, so a tile
 * reads "Francisco played", not a truncated full name.
 */
export function shortName(displayName: string | null | undefined): string {
  return displayName?.trim().split(/\s+/)[0] || "Them";
}

/** The whole empty state, one line. */
export function emptyHeading(range: HeadToHeadRange): string {
  if (range === "all") return "No games in common yet";
  return `No games in common in the last ${range} days`;
}

/**
 * The run at the end of the shared days: how many decided days in a row went
 * the same way. Days nobody took (`none`) are skipped, not run-breakers.
 */
export function currentStreak(
  days: readonly HeadToHeadDay[],
): { outcome: Exclude<HeadToHeadOutcome, "none">; length: number } | null {
  let outcome: Exclude<HeadToHeadOutcome, "none"> | null = null;
  let length = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const o = days[i]?.outcome;
    if (!o || o === "none") continue;
    if (outcome === null) outcome = o;
    if (o !== outcome) break;
    length += 1;
  }
  return outcome === null ? null : { outcome, length };
}

export function streakLabel(days: readonly HeadToHeadDay[], friendName: string): string | null {
  const s = currentStreak(days);
  if (!s || s.length < 2) return null;
  if (s.outcome === "win") return `You've won the last ${s.length}`;
  if (s.outcome === "loss") return `${friendName} won the last ${s.length}`;
  return `${s.length} ties in a row`;
}

/** The last `count` shared days, oldest first: the form strip. */
export function recentForm(days: readonly HeadToHeadDay[], count: number): HeadToHeadDay[] {
  return days.slice(Math.max(0, days.length - count));
}

export interface WinsPoint {
  periodKey: string;
  /** Where the day starts on the time axis, 0–1. Each day is one equal slot. */
  x: number;
  /** Matchups each side has won across every game, up to and including this day. */
  viewer: number;
  friend: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (periodKey: string) => Math.round(Date.parse(`${periodKey}T00:00:00Z`) / DAY_MS);

/**
 * Matchups won by day across all games, as two running totals: the series
 * behind the "Matchups won" chart. The last point's totals are the
 * scoreboard's score. Ties and undecided days move neither total. More days
 * than `maxPoints` are thinned to evenly spaced samples that keep the last.
 */
export function winsSeries(games: readonly HeadToHeadGame[], maxPoints: number): WinsPoint[] {
  const byDay = new Map<string, { viewer: number; friend: number }>();
  for (const g of games) {
    for (const d of g.days) {
      const day = byDay.get(d.periodKey) ?? { viewer: 0, friend: 0 };
      if (d.outcome === "win") day.viewer += 1;
      if (d.outcome === "loss") day.friend += 1;
      byDay.set(d.periodKey, day);
    }
  }
  const keys = [...byDay.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return [];
  const start = dayNumber(first);
  const slots = dayNumber(last) - start + 1;
  let viewer = 0;
  let friend = 0;
  const points = keys.map((periodKey) => {
    const day = byDay.get(periodKey);
    viewer += day?.viewer ?? 0;
    friend += day?.friend ?? 0;
    return { periodKey, x: (dayNumber(periodKey) - start) / slots, viewer, friend };
  });
  if (points.length <= maxPoints || maxPoints < 1) return points;
  const sampled: WinsPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const p = points[Math.round(((i + 1) * points.length) / maxPoints) - 1];
    if (p) sampled.push(p);
  }
  return sampled;
}

export type StepSegment =
  | { kind: "run"; x0: number; x1: number; y: number }
  | { kind: "rise"; x: number; y0: number; y1: number };

/**
 * One side's running total as a step line from 0: a flat run until the next
 * win, then a rise. Only horizontal and vertical pieces, so it draws with
 * plain views. Values are raw counts; the chart scales them.
 */
export function stepSegments(
  points: readonly WinsPoint[],
  side: "viewer" | "friend",
): StepSegment[] {
  const segments: StepSegment[] = [];
  let x = 0;
  let y = 0;
  for (const p of points) {
    const next = p[side];
    if (next === y) continue;
    if (p.x > x) segments.push({ kind: "run", x0: x, x1: p.x, y });
    segments.push({ kind: "rise", x: p.x, y0: y, y1: next });
    x = p.x;
    y = next;
  }
  segments.push({ kind: "run", x0: x, x1: 1, y });
  return segments;
}

/** `2026-06-30` → `Jun 30`. */
export function shortDate(periodKey: string): string {
  const d = new Date(`${periodKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodKey;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** `Friends since Nov 4`, with the year once it isn't this one. */
export function friendsSinceLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Friends";
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `Friends since ${date}`;
}

/** Up to three mutual friends by name, a count past that; null with none. */
export function mutualFriendsLabel(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length > 3) return `${names.length} mutual friends`;
  return `${names.length === 1 ? "Mutual friend" : "Mutual friends"}: ${names.join(", ")}`;
}
