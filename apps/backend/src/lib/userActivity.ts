// Records "this user used this app today" for the admin analytics dashboard
// (DAU / MAU in `GET /v1/admin/analytics`). One `user_activity_days` row per
// (user, client, UTC day); the insert is memoized per Lambda container so a
// busy user costs one tiny write per app per day per container, not one per
// request. Never throws — analytics must not fail a real request.

import type { WorkshopClient } from "@workshop/shared/constants";
import { getDb } from "../db/client.js";
import { userActivityDays } from "../db/schema.js";
import { logger } from "./logger.js";

const MAX_MEMO = 5_000;
const seen = new Set<string>();

/** UTC calendar day as `YYYY-MM-DD`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Requests without a validated `X-Workshop-Client` header are attributed to
 * Workshop: HighScore has sent the header since its first build, so a
 * header-less first-party request is a pre-header Workshop install.
 */
function activityClient(client: WorkshopClient | null): WorkshopClient {
  return client ?? "workshop";
}

export async function recordUserActivity(
  userId: string,
  client: WorkshopClient | null,
  now = new Date(),
): Promise<void> {
  const day = utcDay(now);
  const resolved = activityClient(client);
  const key = `${userId}\u0000${resolved}\u0000${day}`;
  if (seen.has(key)) return;
  try {
    await getDb()
      .insert(userActivityDays)
      .values({ userId, client: resolved, day })
      .onConflictDoNothing();
    if (seen.size >= MAX_MEMO) seen.clear();
    seen.add(key);
  } catch (error) {
    logger.warn("failed to record user activity", { error, userId, client: resolved, day });
  }
}

/** Test hook: forget the per-container memo. */
export function resetUserActivityMemoForTesting(): void {
  seen.clear();
}
