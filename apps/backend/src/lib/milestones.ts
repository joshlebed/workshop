// First-time milestones (`user_milestones`): the durable "when did this user
// first …" record behind the admin "2-3-1" activation cohorts. One row per
// (user, key), insert-only — every write is `ON CONFLICT DO NOTHING`, so
// `reached_at` is the first time and a repeat is a no-op.
//
// Each writer is one statement that reads `users.signup_source` and, for the
// count milestones (second friend, third game), the current count, so the
// call sites pay one round trip and never a read-then-write race. Writers
// never throw: instrumentation must not fail the action that reached the
// milestone (and during a deploy the table may not exist yet).
//
// **If you add a new way to reach a milestone, call the writer there too**
// (see apps/backend/CLAUDE.md → "Activation milestones").

import type { MilestoneKey } from "@workshop/shared/constants";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { logger } from "./logger.js";
import { requestOriginColumns } from "./requestContext.js";
import type { DbClient } from "./sql.js";

/**
 * Entry context stored on the row. `by_self` is false when another person's
 * request reached it for this user (the other side of a new friendship); the
 * client / platform are then unknown, so they are null rather than the other
 * person's.
 */
function contextSql(userAlias: string, bySelf: boolean) {
  const origin = bySelf
    ? requestOriginColumns()
    : { client: null, platform: null, appVersion: null };
  return sql`jsonb_build_object(
    'signup_source', ${sql.raw(userAlias)}.signup_source,
    'client', ${origin.client}::text,
    'platform', ${origin.platform}::text,
    'app_version', ${origin.appVersion}::text,
    'by_self', ${bySelf}::boolean
  )`;
}

async function safely(what: string, userId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    logger.warn("milestone write failed", { what, userId, error });
  }
}

/** Record plain (non-count) milestones for `userId`, now. */
export async function recordMilestones(
  userId: string,
  keys: readonly MilestoneKey[],
  db: DbClient = getDb(),
): Promise<void> {
  if (keys.length === 0) return;
  await safely(keys.join(","), userId, () =>
    db.execute(sql`
      INSERT INTO user_milestones (user_id, key, reached_at, context)
      SELECT u.id, k.key, now(), ${contextSql("u", true)}
      FROM users u
      CROSS JOIN unnest(ARRAY[${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `,
      )}]::text[]) AS k(key)
      WHERE u.id = ${userId}
      ON CONFLICT DO NOTHING
    `),
  );
}

/**
 * After a new friendship: first / second friend for both people, from the
 * edges they have now. `actorId` is whoever's request formed the edge.
 */
export async function recordFriendMilestones(
  a: string,
  b: string,
  actorId: string | null,
  db: DbClient = getDb(),
): Promise<void> {
  for (const userId of [a, b]) {
    await safely("friends", userId, () =>
      db.execute(sql`
        INSERT INTO user_milestones (user_id, key, reached_at, context)
        SELECT u.id, k.key, now(), ${contextSql("u", userId === actorId)}
        FROM users u
        CROSS JOIN (
          SELECT count(*)::int AS n FROM friendships
          WHERE user_low = ${userId} OR user_high = ${userId}
        ) c
        CROSS JOIN (VALUES ('first_friend', 1), ('second_friend', 2)) AS k(key, threshold)
        WHERE u.id = ${userId} AND c.n >= k.threshold
        ON CONFLICT DO NOTHING
      `),
    );
  }
}

/** After a game is newly added to My Games: first / third game, from the games they have now. */
export async function recordGameMilestones(userId: string, db: DbClient = getDb()): Promise<void> {
  await safely("games", userId, () =>
    db.execute(sql`
      INSERT INTO user_milestones (user_id, key, reached_at, context)
      SELECT u.id, k.key, now(), ${contextSql("u", true)}
      FROM users u
      CROSS JOIN (SELECT count(*)::int AS n FROM user_games WHERE user_id = ${userId}) c
      CROSS JOIN (VALUES ('first_game', 1), ('third_game', 3)) AS k(key, threshold)
      WHERE u.id = ${userId} AND c.n >= k.threshold
      ON CONFLICT DO NOTHING
    `),
  );
}

/** After a score post (both write paths): first score, and first share-sheet score. */
export async function recordScoreMilestones(
  userId: string,
  entrySource: string | null | undefined,
  db: DbClient = getDb(),
): Promise<void> {
  await recordMilestones(
    userId,
    entrySource === "share_extension"
      ? ["first_score", "first_share_extension_score"]
      : ["first_score"],
    db,
  );
}
