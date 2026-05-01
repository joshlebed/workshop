import * as Sentry from "@sentry/aws-serverless";
import { getConfig } from "./config.js";

let initialized = false;

// Idempotent — safe to call from both lambda.ts (Lambda runtime) and
// server.ts (local dev) without double-installing global hooks.
export function initSentry() {
  if (initialized) return;
  const cfg = getConfig();
  if (!cfg.sentryDsn) return;
  Sentry.init({
    dsn: cfg.sentryDsn,
    environment: cfg.stage,
    // Sample only 10% of traces to stay inside the free-tier perf-event quota
    // (10k/month). Errors are 100% — they're cheap and what we actually care
    // about during beta.
    tracesSampleRate: 0.1,
    // Lambda's `process.exit` after each invocation can race the Sentry
    // outbound flush; the SDK's awsIntegration wraps the handler to drain
    // before the runtime freezes the container. wrapHandler() in lambda.ts
    // applies that wrapping.
  });
  initialized = true;
}

export { Sentry };
