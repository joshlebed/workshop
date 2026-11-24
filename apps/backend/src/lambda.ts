import { handle, type LambdaEvent } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { runDailyDigestJob } from "./jobs/dailyDigest.js";
import { runDiscordHealthJob } from "./jobs/discordHealth.js";
import { runDiscordMergedJob } from "./jobs/discordMerged.js";
import { runNeonQuotaJob } from "./jobs/neonQuota.js";
import { runScheduledPlayReminders } from "./jobs/playReminders.js";
import { runRequestRollupJob } from "./jobs/requestRollups.js";
import { runJob } from "./jobs/runJob.js";
import { isSnsEvent, runVendorAlarmJob } from "./jobs/vendorAlarm.js";
import { warmGameCodeSandboxIfEnabled } from "./lib/gameCodeService.js";
import { logger } from "./lib/logger.js";
import { pruneExpiredRateLimits } from "./middleware/rate-limit.js";

const app = buildApp();
// Init runs at full CPU; a request runs at a fraction of a vCPU. See the
// function's comment for why this is a no-op while GAME_CODE_PARSING is off.
warmGameCodeSandboxIfEnabled();
const apiHandler = handle(app);

const JOBS = [
  "play-reminders",
  "request-rollups",
  "discord-health",
  "discord-merged",
  "daily-digest",
  "neon-quota",
] as const;
type JobName = (typeof JOBS)[number];

interface JobEvent {
  job: JobName;
}

function jobOf(event: unknown): JobEvent["job"] | null {
  const job = typeof event === "object" && event !== null ? (event as { job?: unknown }).job : null;
  return JOBS.find((j) => j === job) ?? null;
}

export async function handler(
  event: LambdaEvent | JobEvent,
  context?: Parameters<typeof apiHandler>[1],
): Promise<unknown> {
  // CloudWatch alarms arrive through an SNS subscription (infra/vendor_alarms.tf).
  if (isSnsEvent(event)) return runVendorAlarmJob(event);
  switch (jobOf(event)) {
    case "play-reminders":
      return runJob("play-reminders", () => runScheduledPlayReminders());
    case "request-rollups":
      return runJob("request-rollups", async () => {
        // Housekeeping rides along with this job; it must not stop it.
        await pruneExpiredRateLimits()
          .then((removed) => {
            if (removed > 0) logger.info("pruned expired rate limits", { removed });
          })
          .catch((error) => logger.warn("rate limit prune failed", { error }));
        return runRequestRollupJob();
      });
    case "discord-health":
      return runJob("discord-health", () => runDiscordHealthJob());
    case "discord-merged":
      return runJob("discord-merged", () => runDiscordMergedJob());
    case "daily-digest":
      return runJob("daily-digest", () => runDailyDigestJob());
    case "neon-quota":
      return runJob("neon-quota", () => runNeonQuotaJob());
    default:
      return apiHandler(event as LambdaEvent, context);
  }
}
