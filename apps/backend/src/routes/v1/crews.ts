// Crews (onboarding spike #8) — one group link that makes everyone who joins
// friends with everyone in it. Rules live in `lib/crews.ts`; this router only
// parses requests and maps results to responses. Mounted at `/v1/crews` behind
// the same flag gate as friends and games.
//
//   POST /v1/crews               create (name) → summary with the share URL
//   GET  /v1/crews/mine          my crews
//   GET  /v1/crews/:token        public preview (landing page + OG card)
//   POST /v1/crews/:token/join   join + befriend every member (blocks excepted)
//   GET  /v1/crews/:id/board     members + today's standings among them
//   POST /v1/crews/:id/leave     leave (friendships stay)

import { CREW_MAX_PER_USER, type MyCrewsResponse } from "@workshop/shared/crews";
import { Hono } from "hono";
import { z } from "zod";
import { callerIpKey } from "../../lib/clientIp.js";
import { getConfig } from "../../lib/config.js";
import { OBJECTIONABLE_CONTENT_MESSAGE } from "../../lib/contentFilter.js";
import {
  createCrew,
  joinCrew,
  leaveCrew,
  listMyCrews,
  loadCrewBoard,
  parseCrewName,
  previewCrew,
} from "../../lib/crews.js";
import { todayPeriodKey } from "../../lib/gameShapes.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { periodKeySchema } from "../../lib/scoreSchemas.js";
import { isValidShareSlug } from "../../lib/shareSlug.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const uuidSchema = z.string().uuid();
const createSchema = z.object({ name: z.string() });

export const crewRoutes = new Hono();

// Same flag gate as friends/games: 404 when the games surface is off.
crewRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) return err(c, "NOT_FOUND", "not found");
  await next();
});

crewRoutes.post(
  "/",
  requireAuth,
  rateLimit({
    family: "v1.crews.create",
    limit: 20,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const body = await parseJsonBody(c, createSchema);
    if (!body.ok) return body.response;
    const name = parseCrewName(body.data.name);
    if (!name.ok) {
      return name.code === "OBJECTIONABLE_CONTENT"
        ? err(c, "VALIDATION", OBJECTIONABLE_CONTENT_MESSAGE, { code: "OBJECTIONABLE_CONTENT" })
        : err(c, "VALIDATION", "Crew names are 1–40 characters on one line.", {
            code: "CREW_NAME_INVALID",
          });
    }
    const result = await createCrew(c.get("userId"), name.name);
    if (result.kind === "limit") {
      return err(c, "CONFLICT", `You can be in up to ${CREW_MAX_PER_USER} crews.`, {
        code: "crew_limit",
      });
    }
    return ok(c, { crew: result.crew }, 201);
  },
);

// Registered before `/:token` so the literal isn't read as a token.
crewRoutes.get("/mine", requireAuth, async (c) => {
  const response: MyCrewsResponse = {
    crews: await listMyCrews(c.get("userId")),
    limit: CREW_MAX_PER_USER,
  };
  return ok(c, response);
});

crewRoutes.get(
  "/:token",
  rateLimit({ family: "v1.crews.preview", limit: 60, windowSec: 60, key: callerIpKey }),
  optionalAuth,
  async (c) => {
    const token = c.req.param("token");
    if (!isValidShareSlug(token)) return err(c, "NOT_FOUND", "crew not found");
    const preview = await previewCrew(token, c.get("userId") as string | undefined);
    if (!preview) return err(c, "NOT_FOUND", "crew not found");
    return ok(c, preview);
  },
);

crewRoutes.post(
  "/:token/join",
  requireAuth,
  rateLimit({
    family: "v1.crews.join",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const token = c.req.param("token");
    if (!isValidShareSlug(token)) return err(c, "NOT_FOUND", "crew not found");
    const result = await joinCrew(c.get("userId"), token);
    switch (result.kind) {
      case "not_found":
        return err(c, "NOT_FOUND", "crew not found");
      case "full":
        return err(c, "CONFLICT", "This crew is full.", { code: "crew_full" });
      case "limit":
        return err(c, "CONFLICT", `You can be in up to ${CREW_MAX_PER_USER} crews.`, {
          code: "crew_limit",
        });
      default:
        return ok(c, result.response);
    }
  },
);

crewRoutes.get("/:id/board", requireAuth, async (c) => {
  const id = uuidSchema.safeParse(c.req.param("id"));
  if (!id.success) return err(c, "NOT_FOUND", "crew not found");
  const periodRaw = c.req.query("period");
  let periodKey = todayPeriodKey();
  if (periodRaw !== undefined) {
    const parsed = periodKeySchema.safeParse(periodRaw);
    if (!parsed.success) return err(c, "VALIDATION", "invalid period");
    periodKey = parsed.data;
  }
  const board = await loadCrewBoard(c.get("userId"), id.data, periodKey);
  if (!board) return err(c, "NOT_FOUND", "crew not found");
  return ok(c, board);
});

crewRoutes.post("/:id/leave", requireAuth, async (c) => {
  const id = uuidSchema.safeParse(c.req.param("id"));
  if (!id.success) return err(c, "NOT_FOUND", "crew not found");
  if (!(await leaveCrew(c.get("userId"), id.data))) return err(c, "NOT_FOUND", "crew not found");
  return ok(c, { ok: true });
});
