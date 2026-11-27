// Per-(user, day) "play with me" share links (Games-tab copy-scores CTA). The
// token resolves to its owner; routing (already-friends → Games home, else →
// profile) is decided in the route layer. The `friend_requests` share-link is a
// separate accept surface — these links never form an edge on their own.

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameScores, gameShareLinks, games } from "../db/schema.js";
import { generateShareSlug } from "./shareSlug.js";

async function readToken(userId: string, dateKey: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ token: gameShareLinks.token })
    .from(gameShareLinks)
    .where(and(eq(gameShareLinks.userId, userId), eq(gameShareLinks.dateKey, dateKey)))
    .limit(1);
  return row?.token ?? null;
}

/**
 * Mint-or-reuse the caller's share link for `dateKey` (idempotent per user+day).
 * The common path is a single SELECT — today's link already exists. A fresh day
 * inserts a new slug; `ON CONFLICT DO NOTHING` (bare — covers both the
 * (user, date) unique and the token unique) plus a re-read makes a double-tap
 * race converge on one row, and a rare slug collision retries with a new token.
 */
export async function findOrCreateGameShareLink(userId: string, dateKey: string): Promise<string> {
  const existing = await readToken(userId, dateKey);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateShareSlug();
    const [inserted] = await getDb()
      .insert(gameShareLinks)
      .values({ userId, dateKey, token })
      .onConflictDoNothing()
      .returning({ token: gameShareLinks.token });
    if (inserted?.token) return inserted.token;
    // A unique fired: either we lost a (user, date) race — re-read returns the
    // winner — or the slug collided, in which case re-read is null and we retry.
    const raced = await readToken(userId, dateKey);
    if (raced) return raced;
  }
  throw new Error("could not allocate a game share link token");
}

/**
 * Resolve a share-link token to its owner, or null when the token is unknown.
 * Callers validate the slug shape first; the unauthenticated resolve route also
 * wraps this in `withDbRetry` (Neon cold-start — see backend CLAUDE.md).
 */
export async function resolveGameShareLink(
  token: string,
): Promise<{ userId: string; dateKey: string } | null> {
  const [row] = await getDb()
    .select({ userId: gameShareLinks.userId, dateKey: gameShareLinks.dateKey })
    .from(gameShareLinks)
    .where(eq(gameShareLinks.token, token))
    .limit(1);
  return row ?? null;
}

/** At most this many titles go on a play-link landing. */
const SHARER_GAME_TITLE_LIMIT = 12;

/** `YYYY-MM-DD` one day before `dateKey`, or null for a malformed key. */
function previousDateKey(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/**
 * The titles of the games the sharer posted a score to on the link's day —
 * shown on the signed-out play-link landing ("Josh played MapTap today").
 * Titles only: never a score, never anything for a token that doesn't resolve
 * (the caller resolves first).
 *
 * The link's `dateKey` is the UTC day it was minted on, while a score's
 * `period_key` is the sharer's local date. Someone west of UTC who shares in
 * the evening minted "tomorrow's" link, so the day before the link's day is
 * the fallback when the link's own day has no scores.
 */
export async function sharerGameTitlesForLink(userId: string, dateKey: string): Promise<string[]> {
  const previous = previousDateKey(dateKey);
  const days = previous ? [dateKey, previous] : [dateKey];
  const rows = await getDb()
    .select({ periodKey: gameScores.periodKey, title: games.title })
    .from(gameScores)
    .innerJoin(games, eq(games.id, gameScores.gameId))
    .where(and(eq(gameScores.userId, userId), inArray(gameScores.periodKey, days)))
    .orderBy(desc(gameScores.updatedAt))
    .limit(SHARER_GAME_TITLE_LIMIT * 2);
  const day = rows.some((r) => r.periodKey === dateKey) ? dateKey : previous;
  const titles: string[] = [];
  for (const row of rows) {
    if (row.periodKey !== day || titles.includes(row.title)) continue;
    titles.push(row.title);
    if (titles.length >= SHARER_GAME_TITLE_LIMIT) break;
  }
  return titles;
}
