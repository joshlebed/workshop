// The two projections of one day.
//
// `GET /v1/games` already returns everything both projections need: My Games
// in my order, each carrying that day's standings across me ∪ my friends. The
// BY GAME projection renders that shape directly (a game per row, its players
// ranked). The BY PLAYER projection is the transpose — a player per row, one
// cell per game in my order — and it is computed here rather than fetched, so
// flipping between them costs a re-render, not a round trip.

import type { FriendSummary } from "@workshop/shared/friends";
import type { GameStandingsEntry, MyGame, ScoreReactionSummary } from "@workshop/shared/games";
import { summarizeGameScoreBody } from "./scoresSummary";

/** One (player × game) intersection. `played: false` = an empty slot. */
export interface PlayerCell {
  gameId: string;
  gameTitle: string;
  played: boolean;
  rank: number | null;
  /**
   * Rank 1 *and* nobody tied for it. Shared first is common in daily games
   * (three people all solve Wordle in 4), and marking every joint-best cell
   * yellow turns the spotlight colour into wallpaper — so only an outright win
   * is marked, and only an outright win counts toward the crown.
   */
  outrightFirst: boolean;
  /** The cell's score mark — see `scoreMark`. Null when nothing is readable. */
  glyph: string | null;
  /** Full distilled body — what the peek and the board show. */
  body: string | null;
  reactions: ScoreReactionSummary[];
}

/** One row of the BY PLAYER projection. */
export interface PlayerRow {
  userId: string;
  displayName: string | null;
  isSelf: boolean;
  /** One cell per game in My Games order; unplayed games are empty slots. */
  cells: PlayerCell[];
  playedCount: number;
  /** Outright #1 finishes today (ties excluded) — the crown metric. */
  firsts: number;
  /** Mean rank across the games they played; null when they played none. */
  avgRank: number | null;
  /** Exactly one row can carry this (see `pickLeader`). */
  isLeader: boolean;
}

const MAX_GLYPH = 5;

/**
 * The ≤5-character mark a matrix cell shows. Daily-game shares are wildly
 * inconsistent, so this reduces the already-distilled body to the smallest
 * thing that still reads as a score: `4/6`, `2:11`, `418`. Anything longer or
 * unparseable returns null and the cell renders a plain "played" mark instead
 * of a truncated string that looks like data but isn't.
 */
export function cellGlyph(body: string | null): string | null {
  if (!body) return null;
  const line = body.split("\n")[0]?.trim();
  if (!line) return null;
  const fraction = line.match(/(\d{1,2})\s*\/\s*(\d{1,3})/);
  if (fraction) {
    const mark = `${fraction[1]}/${fraction[2]}`;
    return mark.length <= MAX_GLYPH ? mark : null;
  }
  const time = line.match(/\b(\d{1,2}:\d{2})\b/);
  if (time?.[1] && time[1].length <= MAX_GLYPH) return time[1];
  const number = line.match(/\b(\d{1,4})\b/);
  if (number?.[1]) return number[1];
  const compact = line.replace(/\s+/g, "");
  return compact.length > 0 && compact.length <= MAX_GLYPH ? compact : null;
}

/**
 * The one number a game is shown by — the same value in the matrix cell, the
 * peek, the board and the profile. Two surfaces showing "99" and "988" for the
 * same play is the fastest way to make a scoreboard untrustworthy.
 *
 * It is the server's parsed `scoreValue` (what the rank is computed from),
 * except where the human mark is a fraction carrying that same value — `4/6`
 * says everything `4` does and one thing more.
 */
export function scoreMark(
  entry: { scoreValue: number | null },
  body: string | null,
): string | null {
  const glyph = cellGlyph(body);
  if (entry.scoreValue === null || !Number.isFinite(entry.scoreValue)) return glyph;
  const value = String(entry.scoreValue);
  if (glyph && /^\d+\/\d+$/.test(glyph) && glyph.split("/")[0] === value) return glyph;
  return value;
}

function scored(entry: GameStandingsEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

interface BuildArgs {
  games: MyGame[];
  /** Accepted friends, so someone who hasn't played today still gets a row. */
  friends: FriendSummary[];
  selfId: string | null;
  selfName: string | null;
}

/**
 * Transpose the day into player rows. Everyone in the friend graph gets a row
 * whether or not they posted — an all-empty strip is the day's most useful
 * signal ("nobody's played Wordle yet") and it keeps rows from appearing and
 * disappearing under the viewer as the day fills in.
 *
 * Order: you first (always pinned, even with nothing posted), then everyone
 * who played, ranked by the crown metric, then everyone who hasn't.
 */
export function buildPlayerRows({ games, friends, selfId, selfName }: BuildArgs): PlayerRow[] {
  const names = new Map<string, string | null>();
  for (const friend of friends) names.set(friend.userId, friend.displayName);
  if (selfId) names.set(selfId, selfName);
  for (const mg of games) {
    for (const entry of mg.standings.entries) {
      if (!names.has(entry.userId)) names.set(entry.userId, entry.displayName);
    }
  }

  // Which games had a sole winner — see `PlayerCell.outrightFirst`.
  const soleWinner = new Map<string, boolean>();
  for (const mg of games) {
    const firsts = mg.standings.entries.filter((e) => scored(e) && e.rank === 1);
    soleWinner.set(mg.gameId, firsts.length === 1);
  }

  const rows: PlayerRow[] = [];
  for (const [userId, displayName] of names) {
    const cells: PlayerCell[] = games.map((mg) => {
      const entry = mg.standings.entries.find((e) => e.userId === userId);
      if (!entry || !scored(entry)) {
        return {
          gameId: mg.gameId,
          gameTitle: mg.game.title,
          played: false,
          rank: null,
          outrightFirst: false,
          glyph: null,
          body: null,
          reactions: [],
        };
      }
      const body = summarizeGameScoreBody(mg.game, entry);
      return {
        gameId: mg.gameId,
        gameTitle: mg.game.title,
        played: true,
        rank: entry.rank,
        outrightFirst: entry.rank === 1 && (soleWinner.get(mg.gameId) ?? false),
        glyph: scoreMark(entry, body),
        body,
        reactions: entry.reactions,
      };
    });

    const played = cells.filter((c) => c.played);
    const ranked = played.filter((c) => c.rank != null);
    rows.push({
      userId,
      displayName,
      isSelf: userId === selfId,
      cells,
      playedCount: played.length,
      firsts: played.filter((c) => c.outrightFirst).length,
      avgRank:
        ranked.length > 0
          ? ranked.reduce((sum, c) => sum + (c.rank ?? 0), 0) / ranked.length
          : null,
      isLeader: false,
    });
  }

  rows.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const byCrown = compareByCrownMetric(a, b);
    if (byCrown !== 0) return byCrown;
    return (a.displayName ?? "").localeCompare(b.displayName ?? "");
  });

  const leader = pickLeader(rows);
  return leader ? rows.map((r) => (r.userId === leader ? { ...r, isLeader: true } : r)) : rows;
}

/** Better player first: most #1s, then most games played, then best mean rank. */
function compareByCrownMetric(a: PlayerRow, b: PlayerRow): number {
  if (a.firsts !== b.firsts) return b.firsts - a.firsts;
  if (a.playedCount !== b.playedCount) return b.playedCount - a.playedCount;
  const aAvg = a.avgRank ?? Number.POSITIVE_INFINITY;
  const bAvg = b.avgRank ?? Number.POSITIVE_INFINITY;
  if (aAvg !== bAvg) return aAvg - bAvg;
  return 0;
}

/**
 * The day's overall leader — the crown. Defined as **most outright #1 finishes
 * today** (a first shared with someone else is not a win), tie-broken by games
 * played and then by mean rank. A day with no outright #1 anywhere has no
 * leader, and a dead heat on all three measures has no leader either: a crown
 * two people wear says nothing.
 */
export function pickLeader(rows: PlayerRow[]): string | null {
  const contenders = rows.filter((r) => r.firsts > 0);
  if (contenders.length === 0) return null;
  const ordered = [...contenders].sort(compareByCrownMetric);
  const [first, second] = ordered;
  if (!first) return null;
  if (second && compareByCrownMetric(first, second) === 0) return null;
  return first.userId;
}

/** One scored player inside a game's standings — the BY GAME cell. */
export interface StandingCell {
  userId: string;
  displayName: string | null;
  isSelf: boolean;
  rank: number | null;
  /** See `PlayerCell.outrightFirst`. */
  outrightFirst: boolean;
  glyph: string | null;
  /**
   * The one comparable number, right-aligned in the standings: the server's
   * parsed `scoreValue` (what the ranking is computed from), falling back to
   * the cell glyph when the game has no parser yet.
   */
  mark: string | null;
  body: string | null;
  reactions: ScoreReactionSummary[];
  updatedAt: string | null;
}

/** BY GAME: the players who posted, in server rank order, with cell marks. */
export function gameStandingCells(mg: MyGame, selfId: string | null): StandingCell[] {
  const scoredEntries = mg.standings.entries.filter(scored);
  const soleWinner = scoredEntries.filter((e) => e.rank === 1).length === 1;
  return scoredEntries.map((entry) => {
    const body = summarizeGameScoreBody(mg.game, entry);
    return {
      userId: entry.userId,
      displayName: entry.displayName,
      isSelf: entry.userId === selfId,
      rank: entry.rank,
      outrightFirst: entry.rank === 1 && soleWinner,
      glyph: scoreMark(entry, body),
      mark: scoreMark(entry, body),
      body,
      reactions: entry.reactions,
      updatedAt: entry.updatedAt,
    };
  });
}
