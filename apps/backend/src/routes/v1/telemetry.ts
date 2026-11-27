import { PRELOGIN_SCORE_EVENTS } from "@workshop/shared/constants";
import { Hono } from "hono";
import { z } from "zod";
import { callerIpKey } from "../../lib/clientIp.js";
import { logger } from "../../lib/logger.js";
import { parseJsonBody } from "../../lib/request.js";
import { ok } from "../../lib/response.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

// Client-reported diagnostics. Currently just the iOS share-intent shape, so we
// can see on the server exactly what the share extension handed the JS layer —
// the share extension is native and never exercised by CI or the web build, so
// this is the only window into "did the result text survive the share sheet, or
// did we only get the game's referral URL?". One structured log line per report:
// CloudWatch group `/aws/lambda/workshop-prod-api`, filter `client_share_intent`.
export const shareIntentSchema = z.object({
  // Where in the app the snapshot was taken (e.g. "layout-redirect").
  source: z.string().max(64).optional(),
  // expo-share-intent's resolved type: "weburl" | "text" | "media" | "file".
  type: z.string().max(32).nullish(),
  hasWebUrl: z.boolean(),
  webUrlLen: z.number().int().nonnegative().max(100000),
  hasText: z.boolean(),
  textLen: z.number().int().nonnegative().max(100000),
  // Truncated previews — share text is the user's own game result, low-risk, but
  // cap hard so we never store a wall of text.
  textPreview: z.string().max(240).optional(),
  webUrlPreview: z.string().max(240).optional(),
  fileCount: z.number().int().nonnegative().max(1000).optional(),
  metaKeys: z.array(z.string().max(60)).max(40).optional(),
  // Runtime/OTA identifiers so we can tell which JS bundle produced the report.
  runtimeVersion: z.string().max(60).nullish(),
  updateId: z.string().max(80).nullish(),
});

// Score-before-sign-in spike (docs/onboarding-spikes-2026-11.md, spike 1): one
// structured line per step of the pre-login score funnel, so "does moving
// sign-in after the first score lift the day-1 score rate?" is a Logs Insights
// query (filter `kind = "prelogin_score"`). Most of these steps happen signed
// out, so the route takes optional auth and is rate-limited per IP. `draftId`
// is a random client id that joins a signed-out draft to its post after
// sign-in. Nothing here is score text: the game key and the parsed number at
// most.
export const preloginScoreSchema = z.object({
  event: z.enum(PRELOGIN_SCORE_EVENTS),
  draftId: z.string().max(64).optional(),
  linkKind: z.enum(["play", "friend"]).optional(),
  gameKey: z.string().max(64).nullish(),
  // Did the pasted game match one the sharer played that day?
  sharerPlayed: z.boolean().optional(),
  // Abandon reason (discarded / expired / post_failed / left_page).
  reason: z.string().max(32).optional(),
  // ms from draft created to this event.
  ageMs: z
    .number()
    .int()
    .nonnegative()
    .max(30 * 86_400_000)
    .optional(),
  platform: z.string().max(16).optional(),
});

export const telemetryRoutes = new Hono();

telemetryRoutes.post(
  "/prelogin-score",
  optionalAuth,
  rateLimit({ family: "v1.telemetry.preloginScore", limit: 60, windowSec: 60, key: callerIpKey }),
  async (c) => {
    const parsed = await parseJsonBody(c, preloginScoreSchema);
    if (!parsed.ok) return parsed.response;
    logger.info("client_prelogin_score", {
      kind: "prelogin_score",
      user_id: c.get("userId") ?? null,
      ...parsed.data,
    });
    return ok(c, { ok: true });
  },
);

telemetryRoutes.post(
  "/share-intent",
  requireAuth,
  rateLimit({
    family: "v1.telemetry.shareIntent",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, shareIntentSchema);
    if (!parsed.ok) return parsed.response;
    logger.info("client_share_intent", {
      kind: "client_telemetry",
      event: "share_intent",
      user_id: c.get("userId"),
      ...parsed.data,
    });
    return ok(c, { ok: true });
  },
);
