import type { MiddlewareHandler } from "hono";
import { displayNameRequired, isAllowedWithoutDisplayName } from "../lib/displayNameLock.js";
import { err } from "../lib/response.js";
import { verifySession } from "../lib/session.js";
import { checkSession, isSessionRevoked, type SessionCheck } from "../lib/sessionRevocation.js";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    impersonatorUserId?: string;
    sessionId?: string;
    sessionVersion?: number;
  }
}

interface PayloadCheckInput {
  ownerUserId: string;
  subjectUserId: string;
  iatSeconds: number;
  sessionId?: string;
  sessionVersion?: number;
}

function checkPayload(input: PayloadCheckInput): Promise<SessionCheck> {
  if (!input.sessionId) return checkSession(input.ownerUserId, input.iatSeconds);
  return checkSession(input.ownerUserId, input.iatSeconds, {
    sessionId: input.sessionId,
    subjectUserId: input.subjectUserId,
    ...(input.sessionVersion !== undefined ? { sessionVersion: input.sessionVersion } : {}),
  });
}

async function isPayloadRevoked(input: PayloadCheckInput): Promise<boolean> {
  return (await checkPayload(input)).revoked;
}

/**
 * Reads the bearer token from `Authorization`, verifies the HMAC, checks
 * server-side revocation, and stores the resulting userId on the request
 * context. Returns the v1 error envelope on any failure.
 *
 * Also enforces the display-name lock (`lib/displayNameLock.ts`): when the
 * token's subject — the impersonated account during an impersonation — has no
 * display name, every route outside the lock's allow-list gets 403
 * `DISPLAY_NAME_REQUIRED`. The name comes from the same `users` read as the
 * revocation check, so the lock adds no query.
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
  let displayNameMissing = false;
  if (payload.impersonatorUserId) {
    if (payload.impersonatorUserId === payload.userId) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    const subject = await checkSession(payload.userId, payload.iat ?? 0);
    if (subject.revoked) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    displayNameMissing = subject.displayNameMissing;
    if (
      await isPayloadRevoked({
        ownerUserId: payload.impersonatorUserId,
        subjectUserId: payload.userId,
        iatSeconds: payload.iat ?? 0,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.sessionVersion ? { sessionVersion: payload.sessionVersion } : {}),
      })
    ) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    c.set("impersonatorUserId", payload.impersonatorUserId);
  } else {
    const own = await checkPayload({
      ownerUserId: payload.userId,
      subjectUserId: payload.userId,
      iatSeconds: payload.iat ?? 0,
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      ...(payload.sessionVersion ? { sessionVersion: payload.sessionVersion } : {}),
    });
    if (own.revoked) {
      return err(c, "UNAUTHORIZED", "invalid or expired session");
    }
    displayNameMissing = own.displayNameMissing;
  }
  if (payload.sessionId) c.set("sessionId", payload.sessionId);
  if (payload.sessionVersion) c.set("sessionVersion", payload.sessionVersion);
  c.set("userId", payload.userId);
  if (displayNameMissing && !isAllowedWithoutDisplayName(c.req.method, c.req.path)) {
    return displayNameRequired(c);
  }
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
    if (payload) {
      const impersonator = payload.impersonatorUserId;
      const impersonatorOk = !impersonator || impersonator !== payload.userId;
      const subjectOk =
        !impersonator || !(await isSessionRevoked(payload.userId, payload.iat ?? 0));
      const ownerUserId = impersonator ?? payload.userId;
      const ownerOk = !(await isPayloadRevoked({
        ownerUserId,
        subjectUserId: payload.userId,
        iatSeconds: payload.iat ?? 0,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        ...(payload.sessionVersion ? { sessionVersion: payload.sessionVersion } : {}),
      }));
      if (impersonatorOk && subjectOk && ownerOk) {
        if (impersonator) c.set("impersonatorUserId", impersonator);
        if (payload.sessionId) c.set("sessionId", payload.sessionId);
        if (payload.sessionVersion) c.set("sessionVersion", payload.sessionVersion);
        c.set("userId", payload.userId);
      }
    }
  }
  await next();
};
