import type { Context, MiddlewareHandler } from "hono";
import { logger } from "../lib/logger.js";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const MAX_UA = 300;
const MAX_URL = 200;
const MAX_VERSION = 32;

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Best-effort platform classifier when the client didn't set
 * `X-Workshop-Platform`. The first-party app sends the header explicitly so this
 * branch only fires for curl, scrapers, OG previewers, etc.
 */
function detectPlatform(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("workshop")) return "ios";
  if (ua.includes("okhttp")) return "android";
  if (ua.includes("expo")) return "expo";
  if (ua.includes("facebookexternalhit") || ua.includes("twitterbot") || ua.includes("slackbot")) {
    return "bot";
  }
  if (ua.includes("mozilla")) return "web";
  return "other";
}

/**
 * Structured per-request log line. Mounted ahead of every other middleware so
 * the `userId`, `status`, and timing are all captured even when downstream
 * handlers throw and the global `onError` builds the response.
 */
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const requestId =
    c.req.header("x-amzn-trace-id") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);

  try {
    await next();
  } finally {
    const userAgent = c.req.header("user-agent");
    const platformHeader = c.req.header("x-workshop-platform");
    const appVersion = c.req.header("x-workshop-app-version");
    const status = c.res?.status ?? 0;

    logger.info("request", {
      kind: "request",
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      route: c.req.routePath,
      status,
      duration_ms: Date.now() - start,
      user_id: c.get("userId") ?? null,
      platform: platformHeader ?? detectPlatform(userAgent),
      app_version: truncate(appVersion, MAX_VERSION),
      ip: clientIp(c),
      origin: truncate(c.req.header("origin"), MAX_URL),
      referer: truncate(c.req.header("referer"), MAX_URL),
      user_agent: truncate(userAgent, MAX_UA),
    });
  }
};
