import { PUSH_PROMPT_STAGES, PUSH_PROMPT_TRIGGERS } from "@workshop/shared/constants";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { pushPromptEvents } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { parseJsonBody } from "../../lib/request.js";
import { requestOriginColumns } from "../../lib/requestContext.js";
import { ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
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

export const telemetryRoutes = new Hono();
telemetryRoutes.use("*", requireAuth);

telemetryRoutes.post(
  "/share-intent",
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

// HighScore push-permission funnel: one report per stage (pre-prompt shown,
// accepted / declined, the OS dialog's answer), with what asked. Logged like
// the share-intent report (filter `client_push_prompt`) and also kept as a
// `push_prompt_events` row, which the admin dashboard's funnel reads.
export const pushPromptSchema = z.object({
  stage: z.enum(PUSH_PROMPT_STAGES),
  trigger: z.enum(PUSH_PROMPT_TRIGGERS),
});

telemetryRoutes.post(
  "/push-prompt",
  rateLimit({
    family: "v1.telemetry.pushPrompt",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, pushPromptSchema);
    if (!parsed.ok) return parsed.response;
    const userId = c.get("userId");
    const origin = requestOriginColumns();
    logger.info("client_push_prompt", {
      kind: "push_prompt",
      user_id: userId,
      stage: parsed.data.stage,
      trigger: parsed.data.trigger,
      platform: origin.platform,
      app_version: origin.appVersion,
    });
    // Impersonated sessions are the operator, not the user: log, don't count.
    if (!c.get("impersonatorUserId")) {
      await getDb()
        .insert(pushPromptEvents)
        .values({
          userId,
          ...parsed.data,
          platform: origin.platform,
          appVersion: origin.appVersion,
        });
    }
    return ok(c, { ok: true });
  },
);
