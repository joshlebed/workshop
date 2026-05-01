import { handle } from "hono/aws-lambda";
import { buildApp } from "./app.js";
import { initSentry, Sentry } from "./lib/sentry.js";

// Sentry must init before the handler is constructed so the integration's
// instrumentation hooks are in place.
initSentry();

const app = buildApp();

// Sentry.wrapHandler captures unhandled errors thrown out of the handler and
// flushes events before the Lambda runtime freezes the container. When SENTRY_DSN
// is unset, initSentry() is a no-op and wrapHandler is a passthrough.
export const handler = Sentry.wrapHandler(handle(app));
