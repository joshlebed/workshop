// The browser half of a managed session: the refresh credential lives in an
// HttpOnly, same-origin cookie delivered through the Pages `/api/*` proxy (see
// docs/decisions.md). Native clients hold theirs in SecureStore and never see
// this cookie.
//
// Extracted from routes/v1/auth.ts so non-auth routes that end a session —
// today `DELETE /v1/users/me` — can clear it without importing another router.

import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { getConfig } from "./config.js";

export const REFRESH_COOKIE = "workshop_refresh_v1";
const REFRESH_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Browser callers are identified by `Origin`, with the platform header as a
 * compatibility fallback for clients that predate it.
 */
export function isBrowserRequest(c: Context): boolean {
  return Boolean(c.req.header("Origin")) || c.req.header("X-Workshop-Platform") === "web";
}

export function setRefreshCredential(c: Context, refreshToken: string): void {
  if (!isBrowserRequest(c)) return;
  setCookie(c, REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: !getConfig().isLocal,
    sameSite: "Lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearRefreshCredential(c: Context): void {
  if (!isBrowserRequest(c)) return;
  deleteCookie(c, REFRESH_COOKIE, {
    secure: !getConfig().isLocal,
    sameSite: "Lax",
    path: "/",
  });
}
