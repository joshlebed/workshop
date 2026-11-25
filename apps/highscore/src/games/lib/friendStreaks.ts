// Friend streaks + weekly quests (spike #10): the copy and the choices the
// screens make, kept pure so they're unit-tested. The server owns every number
// (`computeFriendStreak`, `friendQuestTarget`); nothing here re-derives one.

import type { FriendQuest, FriendSummary } from "@workshop/shared/friends";
import { type FriendStreak, friendStreakAtRisk, STREAK_MIN_DAYS } from "@workshop/shared/games";

/** First name, or "your friend". */
export function friendFirstName(displayName: string | null | undefined): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || "your friend";
}

/** The pair-flame count to show, or null below `STREAK_MIN_DAYS`. */
export function pairFlame(streak: FriendStreak | null | undefined): number | null {
  const days = streak?.days ?? 0;
  return days >= STREAK_MIN_DAYS ? days : null;
}

/** "5 days in a row you both posted" — the profile's streak line. */
export function pairStreakLabel(days: number): string {
  return `${days} days in a row you both posted`;
}

export interface KeepAliveLine {
  friendId: string;
  days: number;
  /** Who still has to post today. */
  waitingOn: "viewer" | "friend" | "both";
  text: string;
}

/**
 * The home's "keep it alive" lines: every friend whose pair streak (≥2) reached
 * yesterday but not today on both sides. Streaks the viewer can save come
 * first, longest first; at most `limit` lines.
 */
export function keepAliveLines(friends: FriendSummary[], limit = 3): KeepAliveLine[] {
  const lines: KeepAliveLine[] = [];
  for (const f of friends) {
    if (!f.streak) continue;
    const waitingOn = friendStreakAtRisk(f.streak);
    if (!waitingOn) continue;
    const name = friendFirstName(f.displayName);
    const days = f.streak.days;
    const text =
      waitingOn === "friend"
        ? `You and ${name}: ${days} days — waiting on ${name} today`
        : `You and ${name}: ${days} days — post to keep it`;
    lines.push({ friendId: f.userId, days, waitingOn, text });
  }
  const mineFirst = (l: KeepAliveLine) => (l.waitingOn === "friend" ? 1 : 0);
  return lines.sort((a, b) => mineFirst(a) - mineFirst(b) || b.days - a.days).slice(0, limit);
}

/** "You + Sam" — a quest row's title. */
export function questTitle(quest: FriendQuest): string {
  return `You + ${friendFirstName(quest.friend.displayName)}`;
}

/** Progress clipped to 0…1 for the bar. */
export function questProgress(quest: FriendQuest): number {
  if (quest.target <= 0) return 1;
  return Math.max(0, Math.min(1, quest.count / quest.target));
}

/** The line under a quest: what's left, or that it's done. */
export function questStatusLine(quest: FriendQuest): string {
  if (quest.completedAt) return `Done · ${quest.count} posted together`;
  const left = Math.max(0, quest.target - quest.count);
  return `${left} more ${left === 1 ? "score" : "scores"} together by Sunday`;
}

/**
 * The one-time home celebration's copy: one quest names the count, several
 * name the friends ("You finished 3 quests — with Barbara, Renata & Dagmawi.").
 */
export function celebrationText(quests: FriendQuest[]): string {
  const [first] = quests;
  if (!first) return "";
  if (quests.length === 1) {
    return `You and ${friendFirstName(first.friend.displayName)} posted ${first.count} scores together this week.`;
  }
  const names = quests.map((q) => friendFirstName(q.friend.displayName));
  return `You finished ${quests.length} quests — with ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}.`;
}

/** "+3 more streaks to keep" under the home's first lines. */
export function moreStreaksLabel(more: number): string {
  return `+${more} more ${more === 1 ? "streak" : "streaks"} to keep · see Friends`;
}

/** "Done with Barbara, Renata & Dagmawi" — finished quests folded into one line. */
export function doneQuestsLabel(done: FriendQuest[]): string {
  const names = done.map((q) => friendFirstName(q.friend.displayName));
  if (names.length <= 1) return `Done with ${names[0] ?? "your friend"}`;
  return `Done with ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** The count shown on a row: capped at the target once it's done. */
export function questCountLabel(quest: FriendQuest): string {
  return `${Math.min(quest.count, quest.target)}/${quest.target}`;
}
