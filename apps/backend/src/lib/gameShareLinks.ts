// Per-(user, day) "play with me" share links (Games-tab copy-scores CTA). The
// token resolves to its owner; routing (already-friends → Games home, else →
// profile) is decided in the route layer. The `friend_requests` share-link is a
// separate accept surface — these links never form an edge on their own.

import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameShareLinks } from "../db/schema.js";
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
export async function resolveGameShareLink(token: string): Promise<{ userId: string } | null> {
  const [row] = await getDb()
    .select({ userId: gameShareLinks.userId })
    .from(gameShareLinks)
    .where(eq(gameShareLinks.token, token))
    .limit(1);
  return row ?? null;
}
