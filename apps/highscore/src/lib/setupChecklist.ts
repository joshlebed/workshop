// Rules for the day-1 "Get set up" card on the Games home (onboarding spike 6).
// Pure, so they're testable without a renderer (same shape as
// shareOnboarding.ts); the hook (src/hooks/useSetupChecklist.ts) feeds it data
// the client already has and the card (games/components/SetupChecklistCard)
// only draws what comes back.
//
// The card lives for the first 48h after signup, or until every row is done,
// whichever comes first. Rows, in priority order — the first open one is the
// card's one live target:
//
//   friend       Add a friend              ✓ at ≥1 friend
//   friend2      Add one more friend       ✓ at ≥2 friends
//   games        Add 3 games               counter, ✓ at ≥3 games
//   score        Post your first score     ✓ at any score
//   share_sheet  Turn on the share sheet   iOS 1.2.0+ only
//   reminder     Turn on a daily reminder  push-capable binary only
//
// A row, once seen done, stays done (`rows` on the flag): unfriending or
// removing a game never un-ticks it, and "first score" doesn't flip back the
// next day when `GET /v1/games` only knows about today.
//
// All state is the `games.setup-checklist` user flag (never localStorage), so
// a reinstall or a second device doesn't re-run it.

import {
  SETUP_CHECKLIST_ROW_IDS,
  type SetupChecklistRowId,
  USER_FLAG_KEYS,
} from "@workshop/shared/constants";

/** How long after signup the card shows. */
export const SETUP_WINDOW_MS = 48 * 60 * 60 * 1000;
/** How long "You're set" stays if the user never taps "Got it". */
export const SETUP_CELEBRATE_MS = 12 * 60 * 60 * 1000;
export const SETUP_GAMES_TARGET = 3;

export type SetupRowId = SetupChecklistRowId;

/** Client-authored value of the `games.setup-checklist` flag. */
export interface SetupChecklistFlagValue {
  /** First time the card was drawn. */
  shownAt?: string;
  /** X on the card — gone for good. */
  dismissedAt?: string;
  /** Every applicable row done; "You're set" was shown from this moment. */
  completedAt?: string;
  /** The card retired: "Got it" / the celebration ran out, or the window ended. */
  retiredAt?: string;
  retiredReason?: "completed" | "expired";
  /** Row id → the first time that row was done (from data when known). */
  rows?: Partial<Record<SetupRowId, string>>;
}

const isoOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;

export function parseSetupFlag(raw: unknown): SetupChecklistFlagValue {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const out: SetupChecklistFlagValue = {};
  for (const key of ["shownAt", "dismissedAt", "completedAt", "retiredAt"] as const) {
    const v = isoOrUndefined(value[key]);
    if (v) out[key] = v;
  }
  if (value.retiredReason === "completed" || value.retiredReason === "expired") {
    out.retiredReason = value.retiredReason;
  }
  if (value.rows && typeof value.rows === "object") {
    const rows: Partial<Record<SetupRowId, string>> = {};
    for (const id of SETUP_CHECKLIST_ROW_IDS) {
      const v = isoOrUndefined((value.rows as Record<string, unknown>)[id]);
      if (v) rows[id] = v;
    }
    if (Object.keys(rows).length > 0) out.rows = rows;
  }
  return out;
}

/** Read the checklist flag out of a `GET /v1/users/me/flags` payload. */
export function setupFlagFrom(flags: Record<string, unknown>): SetupChecklistFlagValue {
  return parseSetupFlag(flags[USER_FLAG_KEYS.setupChecklist]);
}

/** Shallow-merge a patch into the flag (`rows` merged per id). */
export function mergeSetupFlag(
  previous: SetupChecklistFlagValue,
  patch: SetupChecklistFlagValue,
): SetupChecklistFlagValue {
  const rows = { ...(previous.rows ?? {}), ...(patch.rows ?? {}) };
  return {
    ...previous,
    ...patch,
    ...(Object.keys(rows).length > 0 ? { rows } : {}),
  };
}

/** A row that only some binaries offer (share sheet, reminders). */
export type OptionalStep = { applicable: false } | { applicable: true; done: boolean | undefined };

/** Everything the rows are derived from. `undefined` = still loading. */
export interface SetupSignals {
  /** `friendsSince` of every friend (`GET /v1/friends`). */
  friendsSince: string[] | undefined;
  /** `addedAt` of every game on the home (`GET /v1/games`). */
  gamesAddedAt: string[] | undefined;
  /** Any score: today's/yesterday's standings, or the share-extension marker. */
  hasScore: boolean | undefined;
  shareSheet: OptionalStep;
  reminder: OptionalStep;
}

export interface SetupRow {
  id: SetupRowId;
  label: string;
  /** One line under the live target only. */
  hint: string;
  /** "1/3" on the games row; null elsewhere. */
  progress: string | null;
  done: boolean;
  /** The first open row — the card's one live target. */
  next: boolean;
  /** When the data says the row was done (friendship / game timestamps); else null. */
  doneAt: string | null;
}

const COPY: Record<SetupRowId, { label: string; hint: string }> = {
  friend: { label: "Add a friend", hint: "Send your invite link to someone you play with." },
  friend2: {
    label: "Add one more friend",
    hint: "Boards are better with three. Send another link.",
  },
  games: { label: `Add ${SETUP_GAMES_TARGET} games`, hint: "Pick from what your friends play." },
  score: { label: "Post your first score", hint: "Play today's game, then paste your result." },
  share_sheet: {
    label: "Turn on the share sheet",
    hint: "Then posting is Share → HighScore → Post.",
  },
  reminder: {
    label: "Turn on a daily reminder",
    hint: "One nudge a day at your usual hour. Skipped once you've played.",
  },
};

/** The `n`-th earliest timestamp (0-based), or null when there are fewer. */
function nthEarliest(timestamps: string[], n: number): string | null {
  const sorted = timestamps
    .filter((t) => !Number.isNaN(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return sorted[n] ?? null;
}

/**
 * The applicable rows in priority order with their live state, or null while
 * any signal is still loading (so the card never flashes a wrong tick).
 */
export function deriveSetupRows(
  signals: SetupSignals,
  flag: SetupChecklistFlagValue,
): SetupRow[] | null {
  const { friendsSince, gamesAddedAt, hasScore, shareSheet, reminder } = signals;
  if (friendsSince === undefined || gamesAddedAt === undefined || hasScore === undefined) {
    return null;
  }
  if (shareSheet.applicable && shareSheet.done === undefined) return null;
  if (reminder.applicable && reminder.done === undefined) return null;

  const sticky = flag.rows ?? {};
  const live: Record<SetupRowId, { applicable: boolean; done: boolean; doneAt: string | null }> = {
    friend: {
      applicable: true,
      done: friendsSince.length >= 1,
      doneAt: nthEarliest(friendsSince, 0),
    },
    friend2: {
      applicable: true,
      done: friendsSince.length >= 2,
      doneAt: nthEarliest(friendsSince, 1),
    },
    games: {
      applicable: true,
      done: gamesAddedAt.length >= SETUP_GAMES_TARGET,
      doneAt: nthEarliest(gamesAddedAt, SETUP_GAMES_TARGET - 1),
    },
    score: { applicable: true, done: hasScore, doneAt: null },
    share_sheet: {
      applicable: shareSheet.applicable,
      done: shareSheet.applicable && shareSheet.done === true,
      doneAt: null,
    },
    reminder: {
      applicable: reminder.applicable,
      done: reminder.applicable && reminder.done === true,
      doneAt: null,
    },
  };

  let nextAssigned = false;
  const rows: SetupRow[] = [];
  for (const id of SETUP_CHECKLIST_ROW_IDS) {
    const state = live[id];
    if (!state.applicable) continue;
    const done = state.done || sticky[id] !== undefined;
    const next = !done && !nextAssigned;
    if (next) nextAssigned = true;
    rows.push({
      id,
      ...COPY[id],
      progress:
        id === "games"
          ? `${Math.min(gamesAddedAt.length, SETUP_GAMES_TARGET)}/${SETUP_GAMES_TARGET}`
          : null,
      done,
      next,
      doneAt: sticky[id] ?? (state.done ? state.doneAt : null),
    });
  }
  return rows;
}

export type SetupCardState =
  | {
      kind: "hidden";
      reason: "loading" | "no_signup" | "dismissed" | "retired" | "expired" | "celebrated";
    }
  | { kind: "checklist"; rows: SetupRow[]; doneCount: number; total: number }
  | { kind: "celebrate"; rows: SetupRow[] };

export interface SetupCardInput {
  /** `user.createdAt`. */
  signedUpAt: string | null | undefined;
  now: Date;
  /** Null while flags load. */
  flag: SetupChecklistFlagValue | null;
  rows: SetupRow[] | null;
}

/** Whether we're still inside the first 48h after signup. */
export function inSetupWindow(signedUpAt: string, now: Date): boolean {
  const start = Date.parse(signedUpAt);
  if (Number.isNaN(start)) return false;
  return now.getTime() - start < SETUP_WINDOW_MS;
}

/**
 * What the card draws. Order of the rules matters:
 *   1. never while flags or rows load (no flash for someone who dismissed it);
 *   2. dismissed / retired → gone for good;
 *   3. every row done → "You're set", once: from `completedAt` (stamped by the
 *      hook the first time this is seen) for `SETUP_CELEBRATE_MS` or until
 *      "Got it" (`retiredAt`). Finishing at hour 47 still celebrates;
 *   4. otherwise only inside the 48h window.
 */
export function setupCardState({ signedUpAt, now, flag, rows }: SetupCardInput): SetupCardState {
  if (!signedUpAt || Number.isNaN(Date.parse(signedUpAt))) {
    return { kind: "hidden", reason: "no_signup" };
  }
  if (flag === null || rows === null) return { kind: "hidden", reason: "loading" };
  if (flag.dismissedAt) return { kind: "hidden", reason: "dismissed" };
  if (flag.retiredAt) return { kind: "hidden", reason: "retired" };

  const allDone = rows.length > 0 && rows.every((r) => r.done);
  if (allDone) {
    if (flag.completedAt) {
      const since = now.getTime() - Date.parse(flag.completedAt);
      if (since >= SETUP_CELEBRATE_MS) return { kind: "hidden", reason: "celebrated" };
      return { kind: "celebrate", rows };
    }
    // Done before ever seeing the card, outside the window: nothing to celebrate.
    if (!inSetupWindow(signedUpAt, now)) return { kind: "hidden", reason: "expired" };
    return { kind: "celebrate", rows };
  }
  if (!inSetupWindow(signedUpAt, now)) return { kind: "hidden", reason: "expired" };
  return {
    kind: "checklist",
    rows,
    doneCount: rows.filter((r) => r.done).length,
    total: rows.length,
  };
}

/**
 * Rows that are done now but not yet on the flag, with the time to record:
 * the data's own timestamp when it has one, else `now` (first seen).
 */
export function newlyDoneRows(
  rows: SetupRow[],
  flag: SetupChecklistFlagValue,
  now: Date,
): { id: SetupRowId; at: string }[] {
  const recorded = flag.rows ?? {};
  return rows
    .filter((r) => r.done && recorded[r.id] === undefined)
    .map((r) => ({ id: r.id, at: r.doneAt ?? now.toISOString() }));
}

/** Whole minutes from signup to `at` (never negative). */
export function minutesSinceSignup(signedUpAt: string, at: string | Date): number {
  const end = typeof at === "string" ? Date.parse(at) : at.getTime();
  const start = Date.parse(signedUpAt);
  if (Number.isNaN(end) || Number.isNaN(start)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** One line per game for "You're set": where the viewer stands today. */
export interface TodayBoardLine {
  gameId: string;
  title: string;
  /** "You're #1 of 3" / "2 friends posted" / "Nobody yet". */
  status: string;
  played: boolean;
}

export interface TodayBoardGame {
  gameId: string;
  title: string;
  viewerHasPlayed: boolean;
  /** Entries with a posted score today. */
  entries: { userId: string; rank: number | null }[];
}

export function todayBoardLines(
  games: TodayBoardGame[],
  selfId: string | null,
  max = 4,
): TodayBoardLine[] {
  return games.slice(0, max).map((g) => {
    const self = selfId ? g.entries.find((e) => e.userId === selfId) : undefined;
    const others = g.entries.filter((e) => e.userId !== selfId).length;
    let status: string;
    if (g.viewerHasPlayed && self?.rank != null) {
      status = `You're #${self.rank} of ${g.entries.length}`;
    } else if (g.viewerHasPlayed) {
      status = others === 0 ? "Posted — first in" : `Posted · ${others} more`;
    } else if (others > 0) {
      status = `${others} ${others === 1 ? "friend" : "friends"} posted`;
    } else {
      status = "Nobody yet";
    }
    return { gameId: g.gameId, title: g.title, status, played: g.viewerHasPlayed };
  });
}
