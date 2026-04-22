import { serve } from "@hono/node-server";
import { buildApp } from "./app.js";
import { getConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 8787);

getConfig();

serve({ fetch: app.fetch, port }, (info) => {
  logger.info("backend listening", { port: info.port });
});
