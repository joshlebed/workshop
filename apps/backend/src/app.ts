import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { itemsRoutes } from "./routes/items.js";

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

  app.onError((err, c) => {
    logger.error("unhandled error", { error: err, path: c.req.path });
    return c.json({ error: "internal server error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.route("/health", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/items", itemsRoutes);

  return app;
}
