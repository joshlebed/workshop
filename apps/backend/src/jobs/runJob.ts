// Every scheduled job runs through this. A failure becomes one `job failed` log
// line, which `infra/backend_alarms.tf` turns into a #workshop-admin ping naming
// no user data.
//
// It deliberately does not rethrow. The scheduler invokes the Lambda
// asynchronously, so a thrown error makes Lambda run the job up to twice more:
// a second pass over play reminders, or a second digest. Every job here runs
// again on its own schedule, so a failed run waits for the next one.

import { logger } from "../lib/logger.js";

export async function runJob<T>(job: string, run: () => Promise<T>): Promise<T | { failed: true }> {
  try {
    return await run();
  } catch (error) {
    logger.error("job failed", { job, error });
    return { failed: true };
  }
}
