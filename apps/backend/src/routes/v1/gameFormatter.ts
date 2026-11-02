// PROTOTYPE — generated share formatters, HighScore's "Summary preview" card.
// Registered onto the Games router (same flag gate and auth):
//
//   POST /v1/games/:id/formatter/preview   layer-1 heuristic over the paste + last 2 shares
//   POST /v1/games/:id/formatter/suggest   layer-2 model-written format(raw), gated
//   PUT  /v1/games/:id/formatter           "Looks good": store the chosen formatter
//   POST /v1/games/:id/formatter/reject    "Show raw": keep the fallback, log it
//
// All of it 404s unless `formatterPreviewOn(userId)` (`GAME_FORMATTER_PREVIEW=on`
// and teach on for the caller); `suggest` also needs `GAME_TEACH_FORMAT=on`.
// Both flags default off and are not in Terraform. `suggest` is the one new
// model call: rate-limited per user and claimed from teach's global daily cap.
//
// Write rule — the same as `PUT /:id/score-spec`: the FIRST formatter for a
// game (no `format_code`) is open to any member; replacing one is admin-only.
// A model-written block is only accepted back with the HMAC token `suggest`
// issued for it, so a client cannot store code the server never generated.

import { createHmac, timingSafeEqual } from "node:crypto";
import { formatShareBodyFallback } from "@workshop/shared/gameRegistry";
import type {
  FormatterCandidate,
  FormatterPreviewResponse,
  FormatterPreviewSample,
  FormatterSuggestResponse,
  SetFormatterResponse,
} from "@workshop/shared/games";
import { and, desc, eq } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbGame, gameScores, games, users } from "../../db/schema.js";
import { isAdminUser } from "../../lib/admin.js";
import { getConfig } from "../../lib/config.js";
import { applyGameCodeChange } from "../../lib/gameCode/admin.js";
import { heuristicFormatCode } from "../../lib/gameCode/heuristicFormat.js";
import { runFormat } from "../../lib/gameCode/runtime.js";
import { toGameShape } from "../../lib/gameShapes.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { claimTeachLlmCall } from "../../lib/teach/budget.js";
import {
  formatterPreviewOn,
  gateGeneratedFormat,
  teachFormatOn,
} from "../../lib/teach/formatGate.js";
import { logTeachEvent, type TeachLogContext } from "../../lib/teach/log.js";
import { writeFormatCode } from "../../lib/teach/writeCode.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const uuidSchema = z.string().uuid();
const rawSchema = z.string().trim().min(1).max(2000);
const previewSchema = z.object({ scoreRaw: rawSchema });
const setSchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("heuristic"), exampleRaw: rawSchema }),
  z.object({
    choice: z.literal("llm"),
    exampleRaw: rawSchema,
    code: z.string().min(1).max(16_000),
    token: z.string().min(1).max(200),
  }),
]);
const rejectSchema = z.object({
  scoreRaw: rawSchema,
  shown: z.array(z.enum(["heuristic", "llm"])).max(2),
});

/** The caller's older shares rendered beside the paste. */
const HISTORY_SAMPLES = 2;
const perUser = (c: Context) => c.get("userId") ?? null;

const requireFormatterPreview: MiddlewareHandler = async (c, next) => {
  if (!formatterPreviewOn(c.get("userId"))) return err(c, "NOT_FOUND", "not found");
  await next();
};

function logContext(c: Context, game: DbGame): TeachLogContext {
  return {
    requestId: c.get("requestId"),
    userId: c.get("userId"),
    gameId: game.id,
    parserVersion: game.codeVersion,
  };
}

async function loadGame(c: Context): Promise<DbGame | null> {
  const id = uuidSchema.safeParse(c.req.param("id"));
  if (!id.success) return null;
  const [game] = await getDb().select().from(games).where(eq(games.id, id.data)).limit(1);
  return game ?? null;
}

/** The paste first, then the caller's newest distinct older shares of this game. */
async function samplesFor(
  game: DbGame,
  userId: string,
  scoreRaw: string,
): Promise<FormatterPreviewSample[]> {
  const rows = await getDb()
    .select({ periodKey: gameScores.periodKey, raw: gameScores.scoreRaw })
    .from(gameScores)
    .where(and(eq(gameScores.gameId, game.id), eq(gameScores.userId, userId)))
    .orderBy(desc(gameScores.periodKey))
    .limit(10);
  const samples: FormatterPreviewSample[] = [
    { periodKey: null, raw: scoreRaw, fallback: formatShareBodyFallback(scoreRaw) },
  ];
  const seen = new Set([scoreRaw.trim()]);
  for (const row of rows) {
    if (samples.length > HISTORY_SAMPLES) break;
    const raw = row.raw.trim();
    if (seen.has(raw) || formatShareBodyFallback(raw) === null) continue;
    seen.add(raw);
    samples.push({ periodKey: row.periodKey, raw, fallback: formatShareBodyFallback(raw) });
  }
  return samples;
}

/** Render `code` over every sample in the sandbox; a failure reads as null. */
async function render(code: string, samples: readonly FormatterPreviewSample[]) {
  const out: (string | null)[] = [];
  for (const sample of samples) {
    const result = await runFormat(code, sample.raw);
    out.push(result.kind === "summary" ? result.text : null);
  }
  return out;
}

function signSuggestion(gameId: string, code: string): string {
  return createHmac("sha256", getConfig().sessionSecret)
    .update(`formatter-suggestion\n${gameId}\n${code}`)
    .digest("base64url");
}

function suggestionTokenValid(gameId: string, code: string, token: string): boolean {
  const expected = Buffer.from(signSuggestion(gameId, code));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function isAdmin(userId: string): Promise<boolean> {
  const [actor] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!actor && isAdminUser(actor);
}

export function registerGameFormatterRoutes(router: Hono): void {
  router.post(
    "/:id/formatter/preview",
    requireFormatterPreview,
    rateLimit({ family: "v1.games.formatter.preview", limit: 60, windowSec: 60, key: perUser }),
    async (c) => {
      const parsed = await parseJsonBody(c, previewSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      if (game.formatCode !== null) {
        const response: FormatterPreviewResponse = {
          hasFormatter: true,
          samples: [],
          heuristic: null,
        };
        return ok(c, response);
      }
      const samples = await samplesFor(game, c.get("userId"), parsed.data.scoreRaw);
      const code = heuristicFormatCode({ title: game.title, parseCode: game.parseCode });
      const heuristic: FormatterCandidate = {
        kind: "heuristic",
        summaries: await render(code, samples),
      };
      const response: FormatterPreviewResponse = { hasFormatter: false, samples, heuristic };
      return ok(c, response);
    },
  );

  router.post(
    "/:id/formatter/suggest",
    requireFormatterPreview,
    rateLimit({ family: "v1.games.formatter.suggest", limit: 6, windowSec: 60, key: perUser }),
    rateLimit({
      family: "v1.games.formatter.suggest.day",
      limit: 30,
      windowSec: 24 * 60 * 60,
      key: perUser,
    }),
    async (c) => {
      if (!teachFormatOn()) return err(c, "NOT_FOUND", "not found");
      const parsed = await parseJsonBody(c, previewSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const context = logContext(c, game);
      const none = (reason: string) => {
        const response: FormatterSuggestResponse = { candidate: null, reason };
        return ok(c, response);
      };
      if (game.formatCode !== null) return none("has_formatter");
      const samples = await samplesFor(game, c.get("userId"), parsed.data.scoreRaw);
      if (!(await claimTeachLlmCall("write_format", context))) return none("budget");
      const written = await writeFormatCode({
        gameTitle: game.title,
        raws: samples.map((s) => s.raw),
      });
      const base = {
        step: "write_format",
        model: written.model,
        llm_ms: written.durationMs,
        raw: parsed.data.scoreRaw,
      };
      if (!written.ok) {
        logTeachEvent("formatter_generated", context, {
          ...base,
          outcome: "unavailable",
          reason: written.reason,
        });
        return none(written.reason);
      }
      if (written.format === null) {
        logTeachEvent("formatter_generated", context, { ...base, outcome: "none" });
        return none("model_wrote_none");
      }
      const gate = await gateGeneratedFormat({
        format: written.format,
        teachingRaw: samples[0]?.raw ?? parsed.data.scoreRaw,
        otherRaws: samples.slice(1).map((s) => s.raw),
      });
      logTeachEvent("formatter_generated", context, {
        ...base,
        outcome: gate.ok ? "accepted" : "rejected",
        reason: gate.ok ? null : gate.reason,
        detail: gate.ok ? null : (gate.detail ?? null),
        input_tokens: written.usage.inputTokens,
        output_tokens: written.usage.outputTokens,
        code: written.format,
      });
      if (!gate.ok) return none(gate.reason);
      const response: FormatterSuggestResponse = {
        candidate: {
          kind: "llm",
          summaries: await render(written.format, samples),
          code: written.format,
          token: signSuggestion(game.id, written.format),
        },
        reason: null,
      };
      return ok(c, response);
    },
  );

  router.put(
    "/:id/formatter",
    requireFormatterPreview,
    rateLimit({ family: "v1.games.formatter.set", limit: 10, windowSec: 60, key: perUser }),
    async (c) => {
      const parsed = await parseJsonBody(c, setSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      const userId = c.get("userId");
      const body = parsed.data;
      // First formatter is open; replacing one is admin-only (score-spec's rule).
      const replacing = game.formatCode !== null;
      if (replacing && !(await isAdmin(userId))) {
        return err(c, "FORBIDDEN", "replacing a game's formatter is limited to admins");
      }
      let code: string;
      if (body.choice === "llm") {
        if (!suggestionTokenValid(game.id, body.code, body.token)) {
          return err(c, "VALIDATION", "that formatter was not suggested for this game");
        }
        code = body.code;
      } else {
        code = heuristicFormatCode({ title: game.title, parseCode: game.parseCode });
      }
      const gate = await gateGeneratedFormat({ format: code, teachingRaw: body.exampleRaw });
      if (!gate.ok) {
        if (gate.reason === "unavailable") {
          return err(c, "INTERNAL", "the code sandbox is unavailable; try again");
        }
        return err(c, "VALIDATION", `formatter rejected: ${gate.reason}`);
      }
      const updated = await getDb().transaction(async (tx) => {
        const [locked] = await tx
          .select({
            codeVersion: games.codeVersion,
            formatCode: games.formatCode,
            parseCode: games.parseCode,
          })
          .from(games)
          .where(eq(games.id, game.id))
          .for("update");
        // Someone stored a formatter (or new parse code) since this was read.
        if (!locked || locked.codeVersion !== game.codeVersion) return null;
        await applyGameCodeChange(tx, {
          gameId: game.id,
          candidate: { parseCode: locked.parseCode, formatCode: code },
          source: "teach",
          authoredBy: userId,
          note:
            body.choice === "llm"
              ? "formatter preview (prototype): generated formatter approved"
              : "formatter preview (prototype): heuristic formatter approved",
          examples: [{ raw: body.exampleRaw }],
        });
        const [row] = await tx.select().from(games).where(eq(games.id, game.id)).limit(1);
        return row ?? null;
      });
      if (!updated) return err(c, "CONFLICT", "the game's code changed; reload and try again");
      logTeachEvent("formatter_approved", logContext(c, updated), {
        choice: body.choice,
        replaced: replacing,
        raw: body.exampleRaw,
      });
      const response: SetFormatterResponse = { game: toGameShape(updated) };
      return ok(c, response);
    },
  );

  router.post(
    "/:id/formatter/reject",
    requireFormatterPreview,
    rateLimit({ family: "v1.games.formatter.reject", limit: 30, windowSec: 60, key: perUser }),
    async (c) => {
      const parsed = await parseJsonBody(c, rejectSchema);
      if (!parsed.ok) return parsed.response;
      const game = await loadGame(c);
      if (!game) return err(c, "NOT_FOUND", "game not found");
      logTeachEvent("formatter_rejected", logContext(c, game), {
        shown: parsed.data.shown,
        raw: parsed.data.scoreRaw,
      });
      return ok(c, { ok: true });
    },
  );
}
