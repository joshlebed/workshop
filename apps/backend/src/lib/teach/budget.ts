// The aggregate cap on teach's model spend. The per-user rate limits bound
// what one account can do; this bounds what everyone together can, so the
// bill stays bounded after `GAME_TEACH` is on for all. One row per UTC day in
// `rate_limits`, the same fixed-window counter the route limiter uses.

import { getDb } from "../../db/client.js";
import { consume } from "../../middleware/rate-limit.js";
import { logger } from "../logger.js";
import type { SqlExecutor } from "../sql.js";
import type { TeachLogContext } from "./log.js";

/**
 * Model calls teach may make per UTC day, both steps and every user together.
 * A call costs at most ~$0.0007 (its token caps at Luna's prices), so this is
 * a ceiling of about $0.35 a day; three beta accounts use a few dozen.
 */
const TEACH_LLM_CALLS_PER_DAY = 500;

const BUCKET_KEY = "teach.llm.global";

function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Claim one model call from today's global budget. False when the budget is
 * spent — or cannot be read: a cost cap that fails open is not a cap, and
 * every caller already treats "no model" as an ordinary outcome.
 */
export async function claimTeachLlmCall(
  step: "find_targets" | "write_code",
  context: TeachLogContext,
  db: SqlExecutor = getDb(),
): Promise<boolean> {
  const fields = {
    kind: "teach_llm_budget",
    step,
    request_id: context.requestId ?? null,
    user_id: context.userId ?? null,
    game_id: context.gameId ?? null,
    limit: TEACH_LLM_CALLS_PER_DAY,
  };
  try {
    const used = await consume(db, BUCKET_KEY, dayStart(new Date()));
    if (used <= TEACH_LLM_CALLS_PER_DAY) return true;
    logger.warn("teach llm daily budget exhausted", { ...fields, outcome: "exhausted", used });
    return false;
  } catch (error) {
    logger.error("teach llm budget check failed", { ...fields, outcome: "error", error });
    return false;
  }
}
