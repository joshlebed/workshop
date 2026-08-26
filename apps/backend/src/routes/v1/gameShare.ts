// Game-share "play with me" links (spec §3 follow-up) — the Games-tab
// copy-scores CTA. A per-(user, day) short link (`/g/:token`) that, when opened:
//   - by someone already friends with the sharer (or the sharer) → Games home
//   - by anyone else → the sharer's profile, where they can add them.
// Routing is decided client-side from this router's resolve payload. This is
// NOT an accept surface — opening a link never forms a friend edge (that's what
// `friend_requests` share links in `friends.ts` are for). Same flag gate as the
// rest of the Games surface (404 when off, so it reads as absent).

import type { GameShareLinkPreview, GameShareLinkResponse } from "@workshop/shared/games";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import { users } from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { friendsOf } from "../../lib/friends.js";
import { todayPeriodKey } from "../../lib/gameShapes.js";
import { findOrCreateGameShareLink, resolveGameShareLink } from "../../lib/gameShareLinks.js";
import { err, ok } from "../../lib/response.js";
import { isValidShareSlug } from "../../lib/shareSlug.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { type RateLimitKeyFn, rateLimit } from "../../middleware/rate-limit.js";

const ipKey: RateLimitKeyFn = (c) => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

/**
 * Where the play link lands — the short, app-routable `/g/:token` form (iOS
 * Universal Links + the Pages OG interceptor both handle it). Games belong to
 * HighScore, so even Workshop's legacy Games tab mints HighScore links. Local
 * links use HighScore's Expo web port (:8082), not Workshop's (:8081).
 */
function gameShareUrl(token: string, isLocal = getConfig().isLocal): string {
  const base = isLocal ? "http://localhost:8082" : "https://highscore.live";
  return `${base}/g/${token}`;
}

export const __internal = { gameShareUrl };

export const gameShareRoutes = new Hono();

// Games flag gate (404 — not 403 — so the surface is indistinguishable from
// absent when off; matches `gameRoutes` / `friendRoutes`).
gameShareRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  await next();
});

// --- POST /v1/game-share — mint/reuse my play link for today ---
// Idempotent per (user, UTC day): re-copying returns the same link all day,
// a fresh slug the next day. Old days' tokens keep resolving.

gameShareRoutes.post(
  "/",
  requireAuth,
  rateLimit({
    family: "v1.gameShare.mint",
    limit: 60,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const token = await findOrCreateGameShareLink(userId, todayPeriodKey());
    const response: GameShareLinkResponse = { token, url: gameShareUrl(token) };
    return ok(c, response, 201);
  },
);

// --- GET /v1/game-share/:token — resolve a play link ---
// Optional auth: a link crawler / signed-out visitor gets just the sharer
// (`user`) for the OG card + the not-friends profile redirect; a signed-in
// request also gets `viewer` (isSelf / isFriend) to pick the landing's route.
// Unauthenticated DB entry, so the opening query wraps in withDbRetry.

gameShareRoutes.get(
  "/:token",
  optionalAuth,
  rateLimit({ family: "v1.gameShare.resolve", limit: 60, windowSec: 60, key: ipKey }),
  async (c) => {
    const token = c.req.param("token");
    if (!isValidShareSlug(token)) return err(c, "NOT_FOUND", "link not found");

    const link = await withDbRetry(() => resolveGameShareLink(token));
    if (!link) return err(c, "NOT_FOUND", "link not found");

    const [sharer] = await getDb()
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, link.userId))
      .limit(1);
    if (!sharer) return err(c, "NOT_FOUND", "link not found");

    const viewerId: string | undefined = c.get("userId");
    let viewer: GameShareLinkPreview["viewer"];
    if (viewerId) {
      const isSelf = viewerId === sharer.id;
      const isFriend = isSelf ? false : (await friendsOf(viewerId)).includes(sharer.id);
      viewer = { isSelf, isFriend };
    }

    const response: GameShareLinkPreview = {
      user: { userId: sharer.id, displayName: sharer.displayName },
      ...(viewer ? { viewer } : {}),
    };
    return ok(c, response);
  },
);
