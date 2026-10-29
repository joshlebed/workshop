import { handle, type LambdaEvent } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { runPlayReminderJob } from "./jobs/playReminders.js";
import { runRequestRollupJob } from "./jobs/requestRollups.js";
import { warmGameCodeSandboxIfEnabled } from "./lib/gameCodeService.js";

const app = buildApp();
// Init runs at full CPU; a request runs at a fraction of a vCPU. See the
// function's comment for why this is a no-op while GAME_CODE_PARSING is off.
warmGameCodeSandboxIfEnabled();
const apiHandler = handle(app);

interface JobEvent {
  job: "play-reminders" | "request-rollups";
}

function jobOf(event: unknown): JobEvent["job"] | null {
  const job = typeof event === "object" && event !== null ? (event as { job?: unknown }).job : null;
  return job === "play-reminders" || job === "request-rollups" ? job : null;
}

export async function handler(
  event: LambdaEvent | JobEvent,
  context?: Parameters<typeof apiHandler>[1],
): Promise<unknown> {
  switch (jobOf(event)) {
    case "play-reminders":
      return runPlayReminderJob();
    case "request-rollups":
      return runRequestRollupJob();
    default:
      return apiHandler(event as LambdaEvent, context);
  }
}
