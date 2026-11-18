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

/** The current lead, as a signed score: `YOU +3`, `ALEX +2`, `EVEN`. Set in the pixel face. */
export function leadLabel(lead: number, friendName: string): string {
  if (lead === 0) return "EVEN";
  return lead > 0 ? `YOU +${lead}` : `${friendName.toUpperCase()} +${-lead}`;
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
