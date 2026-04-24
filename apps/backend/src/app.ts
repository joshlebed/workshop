import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { err } from "./lib/response.js";
import { healthRoutes } from "./routes/health.js";

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

  // /v1 surface lands incrementally per docs/redesign-plan.md. Until OAuth
  // (Phase 0b) and CRUD (Phase 1) ship, every /v1 path returns 501 so old
  // clients fail loud rather than silently 404.
  app.all("/v1/*", (c) => err(c, "INTERNAL", "v1 not implemented yet", undefined, 501));

  return app;
}
