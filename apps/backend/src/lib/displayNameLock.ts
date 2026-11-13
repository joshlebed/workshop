// Accounts with no display name are locked until they pick one. `requireAuth`
// refuses every authenticated request from such a user — the subject of the
// token, so an admin impersonating a nameless account is locked too — except
// the routes below, which are what a client needs to find out it must ask for
// a name, set it, or leave.
//
// A nameless account exists when the identity provider gave no usable name
// (see lib/displayName.ts). Both apps route it to `/onboarding/display-name`
// from `needsDisplayName` / `user.displayName == null`; this lock is the
// server side of the same rule, so an old client or a script can't post
// scores, friend people or write lists as a blank name.
//
// Routes that are not behind `requireAuth` (sign-in, `/v1/auth/refresh`,
// `GET /v1/client/release`, public previews, `optionalAuth` reads) are not
// affected.

import type { Context } from "hono";
import { err } from "./response.js";

const DISPLAY_NAME_REQUIRED = "DISPLAY_NAME_REQUIRED";

/** `METHOD /path` pairs a nameless account may still call. Exact paths. */
const ALLOWED = new Set([
  // Who am I? Clients derive "needs a name" from `user.displayName == null`
  // here, which is what sends even an old binary to the name screen.
  "GET /v1/auth/me",
  // Legacy-token → managed-session upgrade on launch (returns needsDisplayName).
  "POST /v1/auth/session",
  "POST /v1/auth/signout",
  // An admin impersonating a nameless account must be able to leave it.
  "POST /v1/auth/impersonation/stop",
  // Set the name (and/or avatar) — the only way out of the lock.
  "PATCH /v1/users/me",
  // Leave for good, or sign out everywhere.
  "DELETE /v1/users/me",
  "DELETE /v1/users/me/sessions",
  // Sign-out unregisters the device's push token.
  "DELETE /v1/me/push-token",
]);

export function isAllowedWithoutDisplayName(method: string, path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return ALLOWED.has(`${method.toUpperCase()} ${normalized}`);
}

/** The refusal. 403 + `details.code` so clients can tell it from a permission error. */
export function displayNameRequired(c: Context) {
  return err(c, "FORBIDDEN", "choose a display name first", { code: DISPLAY_NAME_REQUIRED });
}
