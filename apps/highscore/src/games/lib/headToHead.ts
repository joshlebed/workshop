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
  viewerPlays: number;
  friendPlays: number;
  /** Games the viewer is ahead in / behind in / level in (with ≥1 decided day). */
  gamesLed: number;
  gamesTrailed: number;
  gamesLevel: number;
}

export function totals(games: readonly HeadToHeadGame[]): Totals {
  const t: Totals = {
    wins: 0,
    losses: 0,
    ties: 0,
    sharedDays: 0,
    viewerPlays: 0,
    friendPlays: 0,
    gamesLed: 0,
    gamesTrailed: 0,
    gamesLevel: 0,
  };
  for (const g of games) {
    t.wins += g.wins;
    t.losses += g.losses;
    t.ties += g.ties;
    t.sharedDays += g.sharedDays;
    t.viewerPlays += g.viewer.plays;
    t.friendPlays += g.friend.plays;
    if (g.wins + g.losses + g.ties === 0) continue;
    if (g.wins > g.losses) t.gamesLed += 1;
    else if (g.wins < g.losses) t.gamesTrailed += 1;
    else t.gamesLevel += 1;
  }
  return t;
}

/** Wins as a whole percent of decided days (ties count as played); null with none. */
export function winPercent(r: WinRecord): number | null {
  const decided = r.wins + r.losses + r.ties;
  return decided === 0 ? null : Math.round((r.wins / decided) * 100);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Under the big score: what it is a score of. `33 days you both played · 6 ties`. */
export function sharedDaysLine(sharedDays: number, ties: number): string {
  const days = `${plural(sharedDays, "day")} you both played`;
  return ties > 0 ? `${days} · ${plural(ties, "tie")}` : days;
}

/** Under a game's name: `You win 38% of the time`. Null with no record. */
export function winRateLine(r: WinRecord): string | null {
  const pct = winPercent(r);
  return pct === null ? null : `You win ${pct}% of the time`;
}

/**
 * Who is ahead in how many games, as a sentence. Null when there is one game
 * or fewer with a record: its own card already says it.
 */
export function gamesLine(t: Totals, friendName: string): string | null {
  const { gamesLed: led, gamesTrailed: trailed, gamesLevel: level } = t;
  if (led + trailed + level < 2) return null;
  const even = level === 0 ? "" : level === 1 ? " 1 is even." : ` ${level} are even.`;
  if (led > 0 && trailed > 0) {
    return `You're ahead in ${plural(led, "game")}, ${friendName} in ${trailed}.${even}`;
  }
  if (led > 0) {
    return level === 0
      ? `You're ahead in all ${led} games.`
      : `You're ahead in ${plural(led, "game")}.${even}`;
  }
  if (trailed > 0) {
    return level === 0
      ? `${friendName} is ahead in all ${trailed} games.`
      : `${friendName} is ahead in ${plural(trailed, "game")}.${even}`;
  }
  return "Dead even in every game.";
}

/** The empty state under the range chips. */
export function emptyLine(range: HeadToHeadRange, friendName: string): string {
  if (range === "all") return `You and ${friendName} haven't played any of the same games yet.`;
  const span = range === "7" ? "week" : "month";
  return `You and ${friendName} haven't played the same game this ${span}.`;
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

export interface LeadPoint {
  periodKey: string;
  /** Viewer's wins minus losses across every game, up to and including this day. */
  lead: number;
}

/**
 * Running lead (wins − losses) by day across all games, for the "who's
 * ahead" chart. More days than `maxPoints` are thinned to evenly spaced
 * samples that always keep the last day, so the chart ends on today's lead.
 */
export function leadSeries(games: readonly HeadToHeadGame[], maxPoints: number): LeadPoint[] {
  const net = new Map<string, number>();
  for (const g of games) {
    for (const d of g.days) {
      const delta = d.outcome === "win" ? 1 : d.outcome === "loss" ? -1 : 0;
      net.set(d.periodKey, (net.get(d.periodKey) ?? 0) + delta);
    }
  }
  let lead = 0;
  const points = [...net.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, delta]) => {
      lead += delta;
      return { periodKey, lead };
    });
  if (points.length <= maxPoints || maxPoints < 1) return points;
  const sampled: LeadPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(((i + 1) * points.length) / maxPoints) - 1;
    const p = points[idx];
    if (p) sampled.push(p);
  }
  return sampled;
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
