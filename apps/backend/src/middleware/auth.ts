import type { MiddlewareHandler } from "hono";
import { err } from "../lib/response.js";
import { verifySession } from "../lib/session.js";
import { isSessionRevoked } from "../lib/sessionRevocation.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    impersonatorUserId?: string;
  }
}

/**
 * Reads the bearer token from `Authorization`, verifies the HMAC, checks
 * server-side revocation, and stores the resulting userId on the request
 * context. Returns the v1 error envelope on any failure.
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
  if (await isSessionRevoked(payload.userId, payload.iat ?? 0)) {
    return err(c, "UNAUTHORIZED", "invalid or expired session");
  }
  if (payload.impersonatorUserId) {
    if (payload.impersonatorUserId === payload.userId) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    if (await isSessionRevoked(payload.impersonatorUserId, payload.iat ?? 0)) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    c.set("impersonatorUserId", payload.impersonatorUserId);
  }
  c.set("userId", payload.userId);
  await next();
};

/**
 * Like `requireAuth`, but never rejects: a valid bearer token sets `userId`
 * (and `impersonatorUserId`); anything missing/invalid is silently ignored and
 * the request proceeds anonymously. For endpoints served to both link crawlers
 * / signed-out visitors (no user) and signed-in users (viewer-relative extras).
 * Read the resulting id as `c.get("userId")` typed `string | undefined`.
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (token.length > 0) {
    const payload = verifySession(token);
    if (payload && !(await isSessionRevoked(payload.userId, payload.iat ?? 0))) {
      const impersonator = payload.impersonatorUserId;
      const impersonatorOk =
        !impersonator ||
        (impersonator !== payload.userId &&
          !(await isSessionRevoked(impersonator, payload.iat ?? 0)));
      if (impersonatorOk) {
        if (impersonator) c.set("impersonatorUserId", impersonator);
        c.set("userId", payload.userId);
      }
    }
  }
  await next();
};
