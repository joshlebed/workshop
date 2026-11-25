// Per-score challenge links (`/c/:token`, onboarding spike #2). A challenge is
// one challenger's score on one game for one day: "I got 937 on today's MapTap.
// Beat me". Minting is idempotent per (challenger, game, day); re-minting
// refreshes the score snapshot. Holding the token vouches a friendship with the
// challenger (the same social proof as a play link), and accepting adds the
// game. Routes: `POST /v1/games/:id/challenges` (games.ts) and
// `/v1/challenges/*` (challenges.ts).

import {
  formatScoreValue,
  type GameChallengeScore,
  type GameScoreUnit,
} from "@workshop/shared/games";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { gameChallenges, gameShareLinks } from "../db/schema.js";
import { getConfig } from "./config.js";
import { generateShareSlug, isValidShareSlug } from "./shareSlug.js";

/**
 * Hours past the end of the period's UTC day that a challenge stays open.
 * Period keys are the poster's local date, so a player at UTC-8 is still on
 * "today" until 08:00 UTC the next day; 12h covers every inhabited timezone
 * west of UTC without letting a challenge outlive the next day's puzzle by much.
 */
export const CHALLENGE_GRACE_HOURS = 12;

const HOUR_MS = 3_600_000;

/** End of `periodKey`'s UTC day plus the grace window. */
export function challengeExpiresAt(periodKey: string): Date {
  const start = Date.parse(`${periodKey}T00:00:00.000Z`);
  if (!Number.isFinite(start)) throw new Error(`invalid period key: ${periodKey}`);
  return new Date(start + (24 + CHALLENGE_GRACE_HOURS) * HOUR_MS);
}

/** Where a challenge lands: HighScore web (`:8081` locally). */
export function challengeUrl(token: string, isLocal = getConfig().isLocal): string {
  const base = isLocal ? "http://localhost:8081" : "https://highscore.live";
  return `${base}/c/${token}`;
}

/** The score to beat, with the display string the OG card and app both print. */
export function challengeScore(
  value: string | number | null,
  summary: string | null,
  unit: GameScoreUnit | null,
): GameChallengeScore {
  const numeric = value === null ? null : Number(value);
  const finite = numeric !== null && Number.isFinite(numeric) ? numeric : null;
  const display = finite !== null ? formatScoreValue(finite, unit) : summary?.trim() || "a score";
  return { value: finite, summary, display };
}

interface MintInput {
  challengerId: string;
  gameId: string;
  periodKey: string;
  scoreValue: string | null;
  scoreSummary: string | null;
}

interface MintedChallenge {
  id: string;
  token: string;
  expiresAt: Date;
  reused: boolean;
}

async function readChallenge(input: MintInput) {
  const [row] = await getDb()
    .select({
      id: gameChallenges.id,
      token: gameChallenges.token,
      expiresAt: gameChallenges.expiresAt,
    })
    .from(gameChallenges)
    .where(
      and(
        eq(gameChallenges.challengerId, input.challengerId),
        eq(gameChallenges.gameId, input.gameId),
        eq(gameChallenges.periodKey, input.periodKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Mint-or-reuse the challenger's link for (game, day). The existing row keeps
 * its token and takes the current score (a corrected score re-challenges with
 * the new number). A fresh row is inserted with `ON CONFLICT DO NOTHING` and
 * re-read, so a double tap converges on one row and a slug collision retries.
 */
export async function findOrCreateChallenge(input: MintInput): Promise<MintedChallenge> {
  const db = getDb();
  const existing = await readChallenge(input);
  if (existing) {
    await db
      .update(gameChallenges)
      .set({ scoreValue: input.scoreValue, scoreSummary: input.scoreSummary })
      .where(eq(gameChallenges.id, existing.id));
    return { ...existing, reused: true };
  }

  const expiresAt = challengeExpiresAt(input.periodKey);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [inserted] = await db
      .insert(gameChallenges)
      .values({ ...input, token: generateShareSlug(), expiresAt })
      .onConflictDoNothing()
      .returning({
        id: gameChallenges.id,
        token: gameChallenges.token,
        expiresAt: gameChallenges.expiresAt,
      });
    if (inserted) return { ...inserted, reused: false };
    const raced = await readChallenge(input);
    if (raced) return { ...raced, reused: true };
  }
  throw new Error("could not allocate a challenge token");
}

/** The challenge row for a token, or null (callers validate the slug first). */
export async function resolveChallenge(token: string) {
  const [row] = await getDb()
    .select()
    .from(gameChallenges)
    .where(eq(gameChallenges.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * Who a `via` token vouches for: the owner of a play link (`/g/:token`) or the
 * challenger of a challenge link (`/c/:token`). Holding either was handed over
 * by that person, so it is proof enough to form the friendship at once. An
 * expired challenge still vouches — the day is over, the introduction isn't.
 */
export async function resolveVouchOwner(via: string | undefined): Promise<string | null> {
  if (via === undefined || !isValidShareSlug(via)) return null;
  const db = getDb();
  const [link] = await db
    .select({ userId: gameShareLinks.userId })
    .from(gameShareLinks)
    .where(eq(gameShareLinks.token, via))
    .limit(1);
  if (link) return link.userId;
  const [challenge] = await db
    .select({ userId: gameChallenges.challengerId })
    .from(gameChallenges)
    .where(eq(gameChallenges.token, via))
    .limit(1);
  return challenge?.userId ?? null;
}
