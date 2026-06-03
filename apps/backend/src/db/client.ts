import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../lib/config.js";
import * as schema from "./schema.js";

let cached: ReturnType<typeof drizzle> | null = null;
let cachedClient: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (cached) return cached;
  const { databaseUrl } = getConfig();
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  cachedClient = postgres(databaseUrl, {
    ssl: isLocalDb ? false : "require",
    max: 1,
    idle_timeout: 20,
    // Per-attempt connect cap. Kept low so `withDbRetry` (db/retry.ts) can fit
    // a second connect attempt within the 15s Lambda timeout when Neon's
    // serverless compute is mid-wake after scaling to zero. If you change this,
    // update `attemptCostMs` in db/retry.ts to match.
    connect_timeout: 5,
  });
  cached = drizzle(cachedClient, { schema });
  return cached;
}
