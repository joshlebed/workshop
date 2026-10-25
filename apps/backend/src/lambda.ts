import { handle, type LambdaEvent } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { runPlayReminderJob } from "./jobs/playReminders.js";
import { warmGameCodeSandboxIfEnabled } from "./lib/gameCodeService.js";

const app = buildApp();
// Init runs at full CPU; a request runs at a fraction of a vCPU. See the
// function's comment for why this is a no-op while GAME_CODE_PARSING is off.
warmGameCodeSandboxIfEnabled();
const apiHandler = handle(app);

interface PlayReminderEvent {
  job: "play-reminders";
}

function isPlayReminderEvent(event: unknown): event is PlayReminderEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { job?: unknown }).job === "play-reminders"
  );
}

export async function handler(
  event: LambdaEvent | PlayReminderEvent,
  context?: Parameters<typeof apiHandler>[1],
): Promise<unknown> {
  if (isPlayReminderEvent(event)) return runPlayReminderJob();
  return apiHandler(event, context);
}
