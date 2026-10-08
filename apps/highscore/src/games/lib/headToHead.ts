// Head-to-head for one day, derived on the client from `GET /v1/games?period=`
// (my rotation, standings of me ∪ friends). Only games *both* of us posted
// count; a tie is a tie. TODO(api): a `/v1/friends/users/:id/head-to-head`
// endpoint could cover all days and games outside my rotation — this is the
// honest subset the current API can answer.

import type { GamesResponse } from "@workshop/shared/games";

export interface HeadToHeadGame {
  gameId: string;
  title: string;
  iconUrl: string | null;
  mine: { rank: number | null; label: string };
  theirs: { rank: number | null; label: string };
  /** Who leads this game: `me`, `them`, or `tie` (equal rank or no ranks). */
  leader: "me" | "them" | "tie";
}

export interface HeadToHead {
  games: HeadToHeadGame[];
  wins: number;
  losses: number;
  ties: number;
}

export function headToHead(
  data: GamesResponse | undefined,
  selfId: string,
  otherId: string,
  label: (entry: {
    scoreValue: number | null;
    parseStatus?: "score" | "no_result" | "failed";
    scoreRaw: string | null;
  }) => string,
): HeadToHead {
  const games: HeadToHeadGame[] = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const g of data?.games ?? []) {
    const mine = g.standings.entries.find((e) => e.userId === selfId && e.scoreRaw);
    const theirs = g.standings.entries.find((e) => e.userId === otherId && e.scoreRaw);
    if (!mine || !theirs) continue;
    let leader: HeadToHeadGame["leader"] = "tie";
    if (mine.rank != null && theirs.rank != null && mine.rank !== theirs.rank) {
      leader = mine.rank < theirs.rank ? "me" : "them";
    } else if (mine.rank != null && theirs.rank == null) leader = "me";
    else if (mine.rank == null && theirs.rank != null) leader = "them";
    if (leader === "me") wins += 1;
    else if (leader === "them") losses += 1;
    else ties += 1;
    games.push({
      gameId: g.gameId,
      title: g.game.title,
      iconUrl: g.game.iconUrl,
      mine: { rank: mine.rank, label: label(mine) },
      theirs: { rank: theirs.rank, label: label(theirs) },
      leader,
    });
  }
  return { games, wins, losses, ties };
}
