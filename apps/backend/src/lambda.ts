import { handle, type LambdaEvent } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { runPlayReminderJob } from "./jobs/playReminders.js";

const app = buildApp();
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
