import { handle, type LambdaEvent } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { runDiscordHealthJob } from "./jobs/discordHealth.js";
import { runDiscordMentionsJob } from "./jobs/discordMentions.js";
import { runDiscordMergedJob } from "./jobs/discordMerged.js";
import { runPlayReminderJob } from "./jobs/playReminders.js";
import { runRequestRollupJob } from "./jobs/requestRollups.js";
import { isSnsEvent, runVendorAlarmJob } from "./jobs/vendorAlarm.js";
import { warmGameCodeSandboxIfEnabled } from "./lib/gameCodeService.js";

const app = buildApp();
// Init runs at full CPU; a request runs at a fraction of a vCPU. See the
// function's comment for why this is a no-op while GAME_CODE_PARSING is off.
warmGameCodeSandboxIfEnabled();
const apiHandler = handle(app);

const JOBS = [
  "play-reminders",
  "request-rollups",
  "discord-mentions",
  "discord-health",
  "discord-merged",
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
      return runPlayReminderJob();
    case "request-rollups":
      return runRequestRollupJob();
    case "discord-mentions":
      return runDiscordMentionsJob();
    case "discord-health":
      return runDiscordHealthJob();
    case "discord-merged":
      return runDiscordMergedJob();
    default:
      return apiHandler(event as LambdaEvent, context);
  }
}
