import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { err } from "./lib/response.js";
import { type RateLimitKeyFn, rateLimit } from "./middleware/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/v1/auth.js";
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
    return err(c, "INTERNAL", "internal server error");
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

  return app;
}
