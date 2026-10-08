// Pure derivations behind the Home box-score rows and the day scorecard.
// Everything comes from `GET /v1/games?period=` (one call per day), which
// already carries each game's full standings — no extra requests.

import type { GameStandingsEntry, MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";

/** Entries that actually posted something (a blank `scoreRaw` is a phantom row). */
export function scoredEntries(entries: GameStandingsEntry[]): GameStandingsEntry[] {
  return entries.filter((e) => !!e.scoreRaw && e.scoreRaw.length > 0);
}

export interface RowSummary {
  /** The viewer's own entry, when they posted. */
  mine: GameStandingsEntry | null;
  /** Rank-1 entry (first by rank, then by update time), or null when nobody has a rank. */
  leader: GameStandingsEntry | null;
  /** Everyone who posted, viewer included. */
  playerCount: number;
  /** Posted entries other than the viewer, in rank order — feeds the facepile. */
  others: GameStandingsEntry[];
  /** True when the viewer holds rank 1 against at least one other ranked player. */
  isWin: boolean;
  /** True when the viewer shares rank 1 with someone else. */
  isTie: boolean;
}

export function rowSummary(game: MyGame, selfId: string | null): RowSummary {
  const entries = scoredEntries(game.standings.entries);
  const mine = entries.find((e) => e.userId === selfId) ?? null;
  const ranked = entries
    .filter((e) => e.rank != null)
    .sort(
      (a, b) =>
        (a.rank ?? 0) - (b.rank ?? 0) || (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""),
    );
  const leader = ranked[0] ?? null;
  const others = entries
    .filter((e) => e.userId !== selfId)
    .sort((a, b) => (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY));
  const rankOnes = ranked.filter((e) => e.rank === 1);
  const isWin = !!mine && mine.rank === 1 && ranked.length > 1 && rankOnes.length === 1;
  const isTie = !!mine && mine.rank === 1 && rankOnes.length > 1;
  return { mine, leader, playerCount: entries.length, others, isWin, isTie };
}

export interface DayScorecard {
  played: number;
  total: number;
  wins: number;
  /** Longest live streak across the viewer's games, with the game it belongs to. */
  bestStreak: { title: string; days: number } | null;
  /** True when anyone in the circle posted anything on this day. */
  anyPlays: boolean;
}

export function dayScorecard(games: MyGame[], selfId: string | null): DayScorecard {
  let played = 0;
  let wins = 0;
  let anyPlays = false;
  let bestStreak: DayScorecard["bestStreak"] = null;
  for (const game of games) {
    const row = rowSummary(game, selfId);
    if (row.playerCount > 0) anyPlays = true;
    if (row.mine) played += 1;
    if (row.isWin) wins += 1;
    const streak = game.standings.viewerStreak;
    if (streak >= STREAK_MIN_DAYS && (!bestStreak || streak > bestStreak.days)) {
      bestStreak = { title: game.game.title, days: streak };
    }
  }
  return { played, total: games.length, wins, bestStreak, anyPlays };
}

export interface GroupedRows {
  toPlay: MyGame[];
  played: MyGame[];
}

/**
 * Home's two sections. The user's own order is kept inside each; a game moves
 * from "to play" to "played" the moment its viewer entry lands.
 */
export function groupRows(games: MyGame[], selfId: string | null): GroupedRows {
  const toPlay: MyGame[] = [];
  const played: MyGame[] = [];
  for (const game of games) {
    (rowSummary(game, selfId).mine ? played : toPlay).push(game);
  }
  return { toPlay, played };
}

/** "#2 of 6" / "#1 of 6 👑" — the viewer's placing cell. */
export function placingLabel(row: RowSummary): string | null {
  if (!row.mine) return null;
  if (row.mine.rank == null) return row.mine.parseStatus === "failed" ? "unread" : "played";
  return `#${row.mine.rank} of ${row.playerCount}`;
}

/** First name only — the leader cell has no room for surnames. */
export function shortName(displayName: string | null): string {
  if (!displayName) return "Someone";
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "Someone";
}
