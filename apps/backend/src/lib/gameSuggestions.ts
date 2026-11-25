// "What to play next" (spike 5): games to suggest to a viewer, in three tiers.
//
// 1. Co-play — item-to-item co-occurrence over `user_games`. The co-players
//    are everyone else who has at least one of the viewer's games (blocked
//    users dropped); a candidate game scores one point per co-player who has
//    it, `FRIEND_WEIGHT` points when the co-player is the viewer's friend.
//    `withGameTitle` is the viewer's game that shares the most co-players
//    with the candidate.
// 2. Friends of friends — only for a viewer with 0–1 games: games the
//    viewer's friends-of-friends posted a score to in the last 7 days, by how
//    many of them did.
// 3. Popular — the official catalog's most played.
//
// Tiers fill in that order up to `limit`, never repeating a game, never a
// game already in My Games. Content gate (the catalog's): a suggested game is
// officially listed (`isOfficiallyListed`) or a friend plays it — never an
// unreviewed URL only strangers added.
//
// Every query is index-bounded: `user_games` by user (PK) or by game
// (`user_games_game_user_idx`), `game_scores` by (user, created_at), `games`
// by id or `normalized_url`. Aggregation happens in SQL, so a response reads
// at most a few dozen rows out of Neon whatever the size of the graph.

import {
  CATALOG_GAME_DEFINITIONS,
  isOfficiallyListed,
  OFFICIAL_CATALOG_EXTRAS,
} from "@workshop/shared/gameRegistry";
import type { GameSuggestion, GameSuggestionReason } from "@workshop/shared/games";
import { normalizeGameUrl } from "@workshop/shared/games";
import { and, asc, desc, eq, gte, inArray, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../db/client.js";
import { gameScores, games, userGames } from "../db/schema.js";
import { blockedIdsFor } from "./blocks.js";
import { friendsOf, friendsOfFriends } from "./friends.js";
import { type GameShapeRow, gameShapeColumns, toGameShape } from "./gameShapes.js";

/** A friend who shares the viewer's games counts this many times one stranger. */
const FRIEND_WEIGHT = 2;
/** Co-players considered, friends first then by overlap (keeps the walk bounded). */
const CO_PLAYER_CAP = 500;
/** Ranked candidates read back per tier before the content gate trims them. */
const CANDIDATE_CAP = 60;
/** Friends-of-friends considered for the fallback tier. */
const FOF_CAP = 500;
/** "This week" for the friends-of-friends tier. */
const FOF_WINDOW_DAYS = 7;
/** A co-play row needs this many co-players, unless one of them is a friend. */
const MIN_COPLAY_PLAYERS = 2;

export const SUGGESTION_LIMIT_DEFAULT = 8;
export const SUGGESTION_LIMIT_MAX = 20;

interface Candidate {
  gameId: string;
  reason: GameSuggestionReason;
}

/** Officially listed `normalized_url`s: catalog registry games + reviewed extras. */
const LISTED_URLS: string[] = [
  ...new Set([
    ...CATALOG_GAME_DEFINITIONS.map((d) => normalizeGameUrl(d.canonicalUrl)).filter(
      (u): u is string => u !== null,
    ),
    ...OFFICIAL_CATALOG_EXTRAS.map((e) => e.normalizedUrl),
  ]),
];

export async function suggestGames(
  viewerId: string,
  limit: number = SUGGESTION_LIMIT_DEFAULT,
): Promise<GameSuggestion[]> {
  const db = getDb();
  const [mineRows, friendIds, blocked] = await Promise.all([
    db.select({ gameId: userGames.gameId }).from(userGames).where(eq(userGames.userId, viewerId)),
    friendsOf(viewerId),
    blockedIdsFor(viewerId),
  ]);
  const myGameIds = mineRows.map((r) => r.gameId);
  const mine = new Set(myGameIds);
  const blockedIds = [...blocked];

  const picked: Candidate[] = [];
  const seen = new Set<string>();
  const shapes = new Map<string, GameShapeRow>();

  /** Gate + append one tier's ranked candidates until `limit` is reached. */
  async function take(tier: Candidate[]): Promise<void> {
    const fresh = tier.filter((c) => !seen.has(c.gameId) && !mine.has(c.gameId));
    if (fresh.length === 0 || picked.length >= limit) return;
    const ids = fresh.map((c) => c.gameId);
    const [rows, friendPlayed] = await Promise.all([
      db.select(gameShapeColumns).from(games).where(inArray(games.id, ids)),
      friendIds.length === 0
        ? Promise.resolve([] as { gameId: string }[])
        : db
            .selectDistinct({ gameId: userGames.gameId })
            .from(userGames)
            .where(and(inArray(userGames.userId, friendIds), inArray(userGames.gameId, ids))),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const friendSet = new Set(friendPlayed.map((r) => r.gameId));
    for (const c of fresh) {
      if (picked.length >= limit) break;
      const row = byId.get(c.gameId);
      if (!row) continue;
      if (!isOfficiallyListed(row) && !friendSet.has(c.gameId)) continue;
      seen.add(c.gameId);
      shapes.set(c.gameId, row);
      picked.push(c);
    }
  }

  // ── Tier 1: co-play ──────────────────────────────────────────────────────
  if (myGameIds.length > 0) {
    await take(await coplayCandidates(viewerId, myGameIds, friendIds, blockedIds));
  }

  // ── Tier 2: friends of friends, for a viewer with 0–1 games ─────────────
  if (picked.length < limit && myGameIds.length <= 1 && friendIds.length > 0) {
    const fof = [...(await friendsOfFriends(viewerId, friendIds, blocked))].slice(0, FOF_CAP);
    if (fof.length > 0) {
      const since = new Date(Date.now() - FOF_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const players = sql<number>`count(distinct ${gameScores.userId})::int`;
      const rows = await db
        .select({ gameId: gameScores.gameId, players })
        .from(gameScores)
        .where(and(inArray(gameScores.userId, fof), gte(gameScores.createdAt, since)))
        .groupBy(gameScores.gameId)
        .orderBy(desc(players), asc(gameScores.gameId))
        .limit(CANDIDATE_CAP);
      await take(
        rows.map((r) => ({
          gameId: r.gameId,
          reason: { kind: "friends_of_friends", players: r.players },
        })),
      );
    }
  }

  // ── Tier 3: the official catalog's most played ──────────────────────────
  if (picked.length < limit) {
    const listed = await db
      .select({ id: games.id })
      .from(games)
      .where(inArray(games.normalizedUrl, LISTED_URLS));
    const listedIds = listed.map((r) => r.id).filter((id) => !mine.has(id) && !seen.has(id));
    if (listedIds.length > 0) {
      const players = sql<number>`count(*)::int`;
      const counts = await db
        .select({ gameId: userGames.gameId, players })
        .from(userGames)
        .where(inArray(userGames.gameId, listedIds))
        .groupBy(userGames.gameId);
      const countById = new Map(counts.map((r) => [r.gameId, r.players]));
      const ranked = [...listedIds].sort(
        (a, b) => (countById.get(b) ?? 0) - (countById.get(a) ?? 0) || a.localeCompare(b),
      );
      await take(ranked.map((gameId) => ({ gameId, reason: { kind: "popular" } })));
    }
  }

  return picked.flatMap((c) => {
    const row = shapes.get(c.gameId);
    return row ? [{ game: toGameShape(row), reason: c.reason }] : [];
  });
}

/**
 * Co-play candidates, best first: two aggregate queries over one bounded
 * co-player set (a CTE), plus the viewer's games' titles for the reason line.
 */
async function coplayCandidates(
  viewerId: string,
  myGameIds: string[],
  friendIds: string[],
  blockedIds: string[],
): Promise<Candidate[]> {
  const db = getDb();
  const overlap = sql<number>`count(*)::int`.as("overlap");
  const isFriend = (
    friendIds.length > 0
      ? sql<boolean>`${inArray(userGames.userId, friendIds)}`
      : sql<boolean>`false`
  ).as("is_friend");
  const co = db.$with("co").as(
    db
      .select({ userId: userGames.userId, isFriend, overlap })
      .from(userGames)
      .where(
        and(
          inArray(userGames.gameId, myGameIds),
          ne(userGames.userId, viewerId),
          blockedIds.length > 0 ? notInArray(userGames.userId, blockedIds) : undefined,
        ),
      )
      .groupBy(userGames.userId)
      .orderBy(desc(sql`is_friend`), desc(sql`overlap`), asc(userGames.userId))
      .limit(CO_PLAYER_CAP),
  );

  const cg = alias(userGames, "cg");
  const players = sql<number>`count(*)::int`;
  const friendPlayers = sql<number>`(count(*) filter (where ${co.isFriend}))::int`;
  const score = sql<number>`sum(case when ${co.isFriend} then ${FRIEND_WEIGHT} else 1 end)::int`;
  const ranked = await db
    .with(co)
    .select({ gameId: cg.gameId, players, friendPlayers, score })
    .from(co)
    .innerJoin(cg, eq(cg.userId, co.userId))
    .where(notInArray(cg.gameId, myGameIds))
    .groupBy(cg.gameId)
    .having(sql`count(*) >= ${MIN_COPLAY_PLAYERS} or count(*) filter (where ${co.isFriend}) > 0`)
    .orderBy(desc(score), desc(players), asc(cg.gameId))
    .limit(CANDIDATE_CAP);
  if (ranked.length === 0) return [];

  // For each candidate, the viewer's game that shares the most co-players.
  const mg = alias(userGames, "mg");
  const n = sql<number>`count(*)::int`;
  const [pairs, myTitles] = await Promise.all([
    db
      .with(co)
      .select({ gameId: cg.gameId, viaGameId: mg.gameId, n })
      .from(co)
      .innerJoin(cg, eq(cg.userId, co.userId))
      .innerJoin(mg, and(eq(mg.userId, co.userId), inArray(mg.gameId, myGameIds)))
      .where(
        inArray(
          cg.gameId,
          ranked.map((r) => r.gameId),
        ),
      )
      .groupBy(cg.gameId, mg.gameId),
    db.select({ id: games.id, title: games.title }).from(games).where(inArray(games.id, myGameIds)),
  ]);
  const titleById = new Map(myTitles.map((r) => [r.id, r.title]));
  const bestVia = new Map<string, { n: number; title: string }>();
  for (const p of pairs) {
    const title = titleById.get(p.viaGameId);
    if (!title) continue;
    const prev = bestVia.get(p.gameId);
    if (!prev || p.n > prev.n || (p.n === prev.n && title.localeCompare(prev.title) < 0)) {
      bestVia.set(p.gameId, { n: p.n, title });
    }
  }

  return ranked.flatMap((r) => {
    const via = bestVia.get(r.gameId);
    if (!via) return [];
    return [
      {
        gameId: r.gameId,
        reason: { kind: "coplay", withGameTitle: via.title, players: r.players },
      },
    ];
  });
}
