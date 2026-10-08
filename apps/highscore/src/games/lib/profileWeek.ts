// Pure derivations behind the profile's week grid. Inputs are the per-day
// profile responses (the subject's score per game per day) and the viewer's
// per-day `GET /v1/games` responses (ranks, incl. the subject's, for games
// both have). No endpoint returns a range of days — see UX-EXPLORATION.md §6.

import type { FriendProfileGame, FriendProfileResponse } from "@workshop/shared/friends";
import type { GamesResponse } from "@workshop/shared/games";

export type CellState =
  /** Subject didn't post. */
  | "none"
  /** Subject posted. */
  | "played"
  /** Subject posted and holds rank 1 among ≥2 players (viewer's circle). */
  | "won"
  /** Subject posted but the day hasn't loaded for the viewer (rank unknown). */
  | "unknown";

export interface WeekCell {
  date: string;
  state: CellState;
  /** The subject's score summary line for the day, when posted. */
  summary: string | null;
  /** Subject rank / player count on the viewer's board, when known. */
  rank: number | null;
  players: number | null;
}

export interface WeekRow {
  game: FriendProfileGame["game"];
  viewerHasGame: boolean;
  cells: WeekCell[];
  /** Days the subject posted in the window. */
  plays: number;
  /** Head-to-head over the window: viewer wins vs subject wins (ties excluded). */
  h2h: { viewer: number; subject: number } | null;
}

export interface WeekSummary {
  plays: number;
  wins: number;
  /** Consecutive days (ending on the window's last day, or the day before) with ≥1 post. Capped at the window. */
  streak: number;
  streakCapped: boolean;
}

export interface ProfileWeek {
  rows: WeekRow[];
  summary: WeekSummary;
}

interface Inputs {
  /** Window days, oldest first. */
  days: string[];
  subjectId: string;
  viewerId: string | null;
  profileByDay: ReadonlyMap<string, FriendProfileResponse>;
  gamesByDay: ReadonlyMap<string, GamesResponse>;
  summarize: (
    game: FriendProfileGame["game"],
    score: NonNullable<FriendProfileGame["score"]>,
  ) => string | null;
}

export function buildProfileWeek({
  days,
  subjectId,
  viewerId,
  profileByDay,
  gamesByDay,
  summarize,
}: Inputs): ProfileWeek {
  // Row order: the subject's own game order from the newest loaded day.
  const anchor = [...days]
    .reverse()
    .map((d) => profileByDay.get(d))
    .find((p) => p?.games);
  const gameList = anchor?.games ?? [];
  const rows: WeekRow[] = [];
  let totalPlays = 0;
  let totalWins = 0;
  const playedDays = new Set<string>();

  for (const pg of gameList) {
    const gameId = pg.game.id;
    let plays = 0;
    let viewerWins = 0;
    let subjectWins = 0;
    let comparable = false;
    const cells: WeekCell[] = days.map((date) => {
      const profile = profileByDay.get(date);
      const scoreRow = profile?.games?.find((g) => g.game.id === gameId) ?? null;
      const score = scoreRow?.score ?? null;
      const summary = score ? summarize(pg.game, score) : null;
      const standings = gamesByDay.get(date)?.games.find((g) => g.gameId === gameId)?.standings;
      const entries = standings?.entries.filter((e) => !!e.scoreRaw) ?? [];
      const subjectEntry = entries.find((e) => e.userId === subjectId) ?? null;
      const viewerEntry = viewerId ? (entries.find((e) => e.userId === viewerId) ?? null) : null;
      const posted = !!score || !!subjectEntry;
      if (!posted) return { date, state: "none", summary: null, rank: null, players: null };
      plays += 1;
      playedDays.add(date);
      if (!standings) return { date, state: "unknown", summary, rank: null, players: null };
      const rank = subjectEntry?.rank ?? null;
      const players = entries.length;
      const won = rank === 1 && players > 1 && entries.filter((e) => e.rank === 1).length === 1;
      if (viewerEntry && subjectEntry && viewerId !== subjectId) {
        comparable = true;
        if (
          viewerEntry.rank != null &&
          subjectEntry.rank != null &&
          viewerEntry.rank !== subjectEntry.rank
        ) {
          if (viewerEntry.rank < subjectEntry.rank) viewerWins += 1;
          else subjectWins += 1;
        }
      }
      if (won) totalWins += 1;
      return { date, state: won ? "won" : "played", summary, rank, players };
    });
    totalPlays += plays;
    rows.push({
      game: pg.game,
      viewerHasGame: pg.viewerHasGame,
      cells,
      plays,
      h2h: comparable ? { viewer: viewerWins, subject: subjectWins } : null,
    });
  }

  // Streak: walk back from the window's last day; allow the run to start the day before.
  let streak = 0;
  let idx = days.length - 1;
  if (idx >= 0 && !playedDays.has(days[idx] ?? "")) idx -= 1;
  while (idx >= 0 && playedDays.has(days[idx] ?? "")) {
    streak += 1;
    idx -= 1;
  }
  const streakCapped = streak > 0 && idx < 0 && playedDays.has(days[0] ?? "");

  return { rows, summary: { plays: totalPlays, wins: totalWins, streak, streakCapped } };
}
