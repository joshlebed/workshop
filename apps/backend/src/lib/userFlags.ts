// Validation + writers for the `user_flags` table — small durable per-user
// key/value state (announcement dismissals, feature-adoption markers). Route
// surface lives in routes/v1/users.ts; canonical key constants in
// `@workshop/shared/constants` (USER_FLAG_KEYS).

import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { z } from "zod";
import type { getDb } from "../db/client.js";
import { userFlags } from "../db/schema.js";

/**
 * Dot-namespaced, lowercase keys (`games.share-extension-score`). Bounded so a
 * client bug can't grow unbounded per-user rows of garbage keys.
 */
export const userFlagKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "invalid flag key");

const USER_FLAG_VALUE_MAX_CHARS = 2048;

/**
 * Any JSON value, capped by serialized size. `undefined` is rejected (it isn't
 * JSON and jsonb can't store it); `null` is allowed.
 */
export const userFlagValueSchema = z.unknown().superRefine((value, ctx) => {
  if (value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value required" });
    return;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value must be JSON-serializable" });
    return;
  }
  if (serialized.length > USER_FLAG_VALUE_MAX_CHARS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value too large" });
  }
});

type Db = ReturnType<typeof getDb>;

/**
 * Record first-ever share-extension score submission. Insert-only
 * (onConflictDoNothing) so `firstAt` is the *first* occurrence, not the latest
 * — this flag is the durable "user actually set up the share sheet" marker.
 */
export async function recordShareExtensionScore(db: Db, userId: string, at: Date): Promise<void> {
  await db
    .insert(userFlags)
    .values({
      userId,
      key: USER_FLAG_KEYS.shareExtensionScore,
      value: { firstAt: at.toISOString() },
      updatedAt: at,
    })
    .onConflictDoNothing();
}
