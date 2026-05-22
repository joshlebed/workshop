import { DrizzleQueryError } from "drizzle-orm/errors";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { err } from "./lib/response.js";
import { type RateLimitKeyFn, rateLimit } from "./middleware/rate-limit.js";
import { requestLog } from "./middleware/request-log.js";
import { healthRoutes } from "./routes/health.js";
import { activityRoutes } from "./routes/v1/activity.js";
import { authRoutes } from "./routes/v1/auth.js";
import { inviteRoutes, publicInviteRoutes } from "./routes/v1/invites.js";
import { itemRoutes } from "./routes/v1/items.js";
import { linkPreviewRoutes } from "./routes/v1/link-preview.js";
import { listRoutes, publicListRoutes } from "./routes/v1/lists.js";
import { memberRoutes } from "./routes/v1/members.js";
import { itemScoreRoutes, listScoresRoutes } from "./routes/v1/scores.js";
import { searchRoutes } from "./routes/v1/search.js";
import { sourcePreviewRoutes } from "./routes/v1/sources.js";
import { userRoutes } from "./routes/v1/users.js";
import { webhookRoutes } from "./routes/v1/webhooks.js";

const clientIp: RateLimitKeyFn = (c) => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

// CORS allowlist. Native clients send no Origin and are unaffected; this only
// constrains browsers. Cloudflare Pages branch previews and localhost dev are
// allowed. The Niteshift sandbox web app proxies through `/api` same-origin
// (see apps/workshop/src/config.ts), so its preview host isn't listed here.
const STATIC_ALLOWED_ORIGINS = new Set<string>([
  "https://workshop-a2v.pages.dev",
  "http://localhost:8081",
  "http://localhost:8787",
  "http://127.0.0.1:8081",
]);

const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.workshop-a2v\.pages\.dev$/,
];

export function isAllowedOrigin(origin: string): boolean {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
}

export function buildApp() {
  const app = new Hono();

  // First so it wraps every other middleware and captures status + userId
  // after downstream handlers (and the global onError handler) run.
  app.use("*", requestLog);

  app.use(
    "*",
    cors({
      origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : null),
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Workshop-Platform",
        "X-Workshop-App-Version",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use(
    "*",
    honoLogger((msg) => logger.debug(msg)),
  );

  app.onError((e, c) => {
    logger.error("unhandled error", { error: e, path: c.req.path });
    const root = unwrapRootError(e);
    const message =
      root instanceof Error
        ? `${root.name}: ${root.message}`.slice(0, 500)
        : "internal server error";
    return err(c, "INTERNAL", message);
  });

  app.notFound((c) => err(c, "NOT_FOUND", "not found"));

  app.get("/", (c) => c.json({ service: "workshop-api" }));
  app.route("/health", healthRoutes);

  app.use(
    "/v1/auth/*",
    rateLimit({
      family: "v1.auth",
      limit: 30,
      windowSec: 60,
      key: clientIp,
    }),
  );

  app.route("/v1/auth", authRoutes);
  app.route("/v1/users", userRoutes);
  app.route("/v1", publicListRoutes);
  app.route("/v1/lists", listRoutes);
  app.route("/v1/lists", memberRoutes);
  app.route("/v1/lists", listScoresRoutes);
  app.route("/v1/items", itemRoutes);
  app.route("/v1/items", itemScoreRoutes);
  app.route("/v1/search", searchRoutes);
  app.route("/v1/link-preview", linkPreviewRoutes);
  app.route("/v1/activity", activityRoutes);
  app.route("/v1/sources", sourcePreviewRoutes);
  // Inbound webhooks for push-driven sources. No auth — signature
  // verification on a per-source shared secret is the auth (§3.6).
  app.route("/v1", webhookRoutes);
  app.route("/v1", publicInviteRoutes);
  app.route("/v1", inviteRoutes);

  return app;
}

function unwrapRootError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  let cur: unknown = e;
  for (let i = 0; i < 5; i++) {
    if (cur instanceof DrizzleQueryError && cur.cause) {
      cur = cur.cause;
      continue;
    }
    if (cur instanceof Error && cur.cause instanceof Error) {
      cur = cur.cause;
      continue;
    }
    break;
  }
  return cur;
}
