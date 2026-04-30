import { DrizzleQueryError } from "drizzle-orm/errors";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { err } from "./lib/response.js";
import { type RateLimitKeyFn, rateLimit } from "./middleware/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { activityRoutes } from "./routes/v1/activity.js";
import { albumShelfRoutes } from "./routes/v1/album-shelf.js";
import { authRoutes } from "./routes/v1/auth.js";
import { inviteRoutes } from "./routes/v1/invites.js";
import { itemRoutes } from "./routes/v1/items.js";
import { linkPreviewRoutes } from "./routes/v1/link-preview.js";
import { listRoutes } from "./routes/v1/lists.js";
import { memberRoutes } from "./routes/v1/members.js";
import { searchRoutes } from "./routes/v1/search.js";
import { userRoutes } from "./routes/v1/users.js";

const clientIp: RateLimitKeyFn = (c) => {
  // API Gateway HTTP API + Hono node-server both populate x-forwarded-for.
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

export function buildApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
    // Surface error name + message in the response so a 500 in the iOS UI is
    // actionable without CloudWatch access. We're the only audience for this
    // API; not worth hiding the underlying error class. DrizzleQueryError's
    // own `.message` is just the failed query + bind params; the actual
    // postgres error (e.g. "invalid input value for enum list_type") lives on
    // `.cause`, so unwrap it to keep the toast useful.
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

  // /v1/auth/* gets a per-IP rate limit — cheap abuse surface, applied before
  // the JWKS fetch and DB upsert.
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
  app.route("/v1/lists", listRoutes);
  app.route("/v1/lists", memberRoutes);
  app.route("/v1/items", itemRoutes);
  app.route("/v1/search", searchRoutes);
  app.route("/v1/link-preview", linkPreviewRoutes);
  app.route("/v1/activity", activityRoutes);
  app.route("/v1/album-shelf", albumShelfRoutes);
  // Invite routes split across two URL roots (`/v1/lists/:id/invites/...`
  // and `/v1/invites/:token/accept`). Mount under `/v1` so both shapes
  // resolve from a single Hono sub-router.
  app.route("/v1", inviteRoutes);

  return app;
}

function unwrapRootError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  // DrizzleQueryError wraps a postgres-js error on `.cause`. Walk the chain
  // (capped) so a deeper cause still surfaces over the wrapper's
  // "Failed query: ..." message.
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
