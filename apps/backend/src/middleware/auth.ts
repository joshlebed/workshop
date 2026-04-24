import type { MiddlewareHandler } from "hono";
import { err } from "../lib/response.js";
import { verifySession } from "../lib/session.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
  }
}

/**
 * Reads the bearer token from `Authorization`, verifies it, and stores the
 * resulting userId on the request context. Returns the v1 error envelope on
 * any failure.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return err(c, "UNAUTHORIZED", "missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    return err(c, "UNAUTHORIZED", "missing bearer token");
  }
  const payload = verifySession(token);
  if (!payload) {
    return err(c, "UNAUTHORIZED", "invalid or expired session");
  }
  c.set("userId", payload.userId);
  await next();
};
