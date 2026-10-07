// Teach v2 end to end against real SQL: the actual drizzle/ migrations on
// in-memory PGlite, the real QuickJS sandbox, and the two LLM steps mocked at
// the `fetch` boundary (so the OpenAI client and its zod validation run too).

import { PGlite } from "@electric-sql/pglite";
import type {
  ApplyScorePickResponse,
  GamesResponse,
  PreviewGameScoreResponse,
  ScoreCandidatesResponse,
  SetScoreDirectionResponse,
  SharePreviewResponse,
  TeachParserResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import { shiftPeriodKey } from "@workshop/shared/games";
import type { ScorePick } from "@workshop/shared/scoreCandidates";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;
vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));
const discord = vi.fn<(content: string, opts?: { kind?: string }) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("../../lib/discord.js", () => ({
  notifyDiscord: (content: string, opts?: { kind?: string }) => discord(content, opts),
}));

import { gameRoutes } from "./games.js";

// The three Games beta accounts (lib/gamesBeta.ts) — teach is on for them
// whatever the flag says — and one account outside the beta.
const josh = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";
const dag = "a75a758c-e3cd-46a4-ae0e-7f4e67ea1c5e";
const paloma = "36d0153a-9db0-475c-8347-905628f6591a";
const outsider = "00000000-0000-4000-8000-000000000009";

const today = new Date().toISOString().slice(0, 10);
const day = (ago: number) => shiftPeriodKey(today, -ago);

const krillion = (puzzle: number, score: number) =>
  `Krillion #${puzzle} 🦐\n${score}\n\n🦑🏮🫧🦑🫧🏮`;
const SCORE_AT = "Krillion #81 🦐\n".length;
const scorePick: ScorePick = { kind: "feature", featureId: `number@${SCORE_AT}` };
const puzzlePick: ScorePick = { kind: "feature", featureId: "number@10" };

const READS_SCORE = `function parse(raw) {
  var m = raw.match(/^\\s*([\\d,]+)\\s*$/m);
  if (!m) throw new Error("no score line");
  return Number(m[1].replace(/,/g, ""));
}`;
const READS_PUZZLE_NUMBER = `function parse(raw) {
  var m = raw.match(/#(\\d+)/);
  if (!m) throw new Error("no puzzle number");
  return Number(m[1]);
}`;
const CONSTANT = "function parse(raw) { return 415; }";
// Right for a "Total 415" share and for the classic one; wrong for any share
// with a number after the score.
const READS_LAST_NUMBER = `function parse(raw) {
  var all = raw.match(/\\d[\\d,]*/g);
  if (!all) throw new Error("no number");
  return Number(all[all.length - 1].replace(/,/g, ""));
}`;

// --- The mocked model -------------------------------------------------------

const llm = {
  /** Programs the write-code step returns, in order. */
  code: [] as string[],
  targets: null as {
    score: number | null;
    puzzle_number: number[];
    date?: number[];
    streak?: number[];
    percentile?: number[];
  } | null,
  fail: null as "http" | "timeout" | null,
  calls: [] as { schema: string; input: string }[],
};

function resetLlm() {
  llm.code = [];
  llm.targets = null;
  llm.fail = null;
  llm.calls = [];
}

const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as {
    input: string;
    text: { format: { name: string } };
    max_output_tokens: number;
  };
  const schema = body.text.format.name;
  llm.calls.push({ schema, input: body.input });
  if (llm.fail === "timeout") throw new DOMException("timed out", "TimeoutError");
  if (llm.fail === "http") return new Response("upstream down", { status: 503 });
  const answer =
    schema === "score_parser"
      ? { code: llm.code.shift() ?? CONSTANT }
      : { date: [], streak: [], percentile: [], ...llm.targets };
  return Response.json({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
    usage: { input_tokens: 1200, output_tokens: 90 },
  });
});

// --- Helpers ----------------------------------------------------------------

function headers(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function call<T>(asUser: string, method: string, path: string, body?: unknown) {
  const res = await gameRoutes.request(path, {
    method,
    headers: headers(asUser),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

let gameCounter = 0;
/** A fresh untaught catalog game whose title and domain both name it "Krillion…". */
async function newGame(): Promise<string> {
  gameCounter += 1;
  const name = `krillion${gameCounter}`;
  const [row] = await rows<{ id: string }>(
    `INSERT INTO games (normalized_url, url, title) VALUES ($1, $2, $3) RETURNING id`,
    [`${name}.io`, `https://${name}.io`, "Krillion"],
  );
  if (!row) throw new Error("game insert failed");
  return row.id;
}

const post = (asUser: string, gameId: string, periodKey: string, scoreRaw: string, extra = {}) =>
  call<UpsertGameScoreResponse>(asUser, "PUT", `/${gameId}/scores`, {
    periodKey,
    scoreRaw,
    ...extra,
  });
const teach = (asUser: string, gameId: string, periodKey: string, extra = {}) =>
  call<TeachParserResponse>(asUser, "POST", `/${gameId}/parser/teach`, { periodKey, ...extra });
const preview = (asUser: string, gameId: string, scoreRaw: string, periodKey = today) =>
  call<PreviewGameScoreResponse>(asUser, "POST", `/${gameId}/scores/preview`, {
    scoreRaw,
    periodKey,
  });

async function gameRow(gameId: string) {
  const [row] = await rows<{
    parse_code: string | null;
    code_version: number;
    score_direction: string;
    direction_set_by: string | null;
    parse_conflict_at: string | null;
  }>(`SELECT * FROM games WHERE id = $1`, [gameId]);
  if (!row) throw new Error("no game");
  return row;
}

async function scoreRow(gameId: string, userId: string, periodKey: string) {
  const [row] = await rows<{
    score_value: string | null;
    parse_status: string | null;
    score_source: string | null;
    code_version: number | null;
    pick_is_example: boolean;
    pick_adjusted: boolean;
  }>(`SELECT * FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = $3`, [
    gameId,
    userId,
    periodKey,
  ]);
  if (!row) throw new Error("no score");
  return row;
}

/** A game Josh has taught to read the score line (version 1). */
async function taughtGame(): Promise<string> {
  const gameId = await newGame();
  await post(josh, gameId, day(5), krillion(81, 415), { pick: scorePick });
  llm.code = [READS_SCORE];
  const taught = await teach(josh, gameId, day(5), { scoreDirection: "desc" });
  expect(taught.body.outcome).toBe("accepted");
  resetLlm();
  fetchMock.mockClear();
  discord.mockClear();
  return gameId;
}

const teachPings = () => discord.mock.calls.filter(([, opts]) => opts?.kind === "parser_taught");

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.OPENAI_API_KEY = "test-key";
  process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.test/webhook";
  delete process.env.GAME_TEACH;
  delete process.env.TYPESAFE_API_KEY;
  resetConfigForTesting();
  vi.stubGlobal("fetch", fetchMock);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'), ($2, 'dag@example.com', 'Dag'),
       ($3, 'paloma@example.com', 'Paloma'), ($4, 'outsider@example.com', 'Outsider')`,
    [josh, dag, paloma, outsider],
  );
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  resetConfigForTesting();
});

beforeEach(async () => {
  // The teach endpoints are rate-limited per user; each test starts fresh.
  await rows("DELETE FROM rate_limits");
  resetLlm();
  fetchMock.mockClear();
  discord.mockClear();
});

describe("the beta gate", () => {
  it("404s every teach endpoint for an account outside the beta", async () => {
    const gameId = await newGame();
    const attempts = [
      call(outsider, "POST", "/score-preview", { scoreRaw: krillion(81, 415), periodKey: today }),
      preview(outsider, gameId, krillion(81, 415)),
      call(outsider, "POST", `/${gameId}/scores/candidates`, { scoreRaw: krillion(81, 415) }),
      call(outsider, "POST", `/${gameId}/scores/${today}/pick`, { pick: scorePick }),
      teach(outsider, gameId, today),
      call(outsider, "PUT", `/${gameId}/score-direction`, { scoreDirection: "asc" }),
      call(outsider, "POST", `/${gameId}/parser/rollback`, { version: 1 }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports teach as a capability only to beta accounts", async () => {
    const mine = await call<GamesResponse>(josh, "GET", "/");
    const theirs = await call<GamesResponse>(outsider, "GET", "/");
    expect(mine.body.capabilities?.teach).toBe(true);
    expect(theirs.body.capabilities?.teach).toBe(false);
  });

  it("leaves an outside account's post on the legacy path, pick ignored", async () => {
    const gameId = await newGame();
    const res = await post(outsider, gameId, today, krillion(81, 415), { pick: scorePick });
    expect(res.status).toBe(200);
    // The legacy first-number fallback, untouched: status and source unset.
    expect(res.body.score.scoreValue).toBe(81);
    expect(res.body.teach).toBeUndefined();
    const row = await scoreRow(gameId, outsider, today);
    expect(row.parse_status).toBeNull();
    expect(row.score_source).toBeNull();
  });
});

describe("the edge-input gate", () => {
  it("rejects empty, URL-only, title-only, over-long and future-day posts before any code runs", async () => {
    const gameId = await newGame();
    const cases: [string, string, string][] = [
      ["empty", "   ", today],
      ["url_only", "https://krillion1.io/?ref=1", today],
      ["title_only", "Krillion - the daily dive", today],
      ["too_long", `${krillion(81, 415)}${"x".repeat(2000)}`, today],
      ["future_day", krillion(81, 415), shiftPeriodKey(today, 3)],
    ];
    for (const [reason, scoreRaw, periodKey] of cases) {
      for (const path of [`/${gameId}/scores`, `/${gameId}/scores/preview`]) {
        const res = await call<{ details: unknown }>(
          josh,
          path.endsWith("preview") ? "POST" : "PUT",
          path,
          { scoreRaw, periodKey },
        );
        expect(res.status, `${reason} ${path}`).toBe(400);
        expect(res.body.details).toEqual({ code: "SCORE_INPUT_REJECTED", reason });
      }
    }
    expect(await rows(`SELECT 1 FROM game_scores WHERE game_id = $1`, [gameId])).toHaveLength(0);
  });

  it("allows junk: it posts unread, without a rank", async () => {
    const gameId = await taughtGame();
    const res = await post(josh, gameId, today, "hi");
    expect(res.status).toBe(200);
    expect(res.body.score).toMatchObject({
      parseStatus: "failed",
      scoreValue: null,
      scoreSource: "parsed",
    });
  });

  it("allows a past day", async () => {
    const gameId = await taughtGame();
    expect((await post(josh, gameId, day(20), krillion(60, 300))).status).toBe(200);
  });
});

describe("preview — a dry run", () => {
  it("is unread with computed candidates for an untaught game, and calls no model", async () => {
    const gameId = await newGame();
    const res = await preview(josh, gameId, krillion(81, 415));
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({
      parseStatus: "failed",
      scoreValue: null,
      teach: { hasParser: false },
    });
    expect(res.body.preview.teach?.candidates.map((c) => c.label)).toEqual(
      expect.arrayContaining(["81", "415", "2 × 🦑", "2 × 🏮", "2 × 🫧"]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rows(`SELECT 1 FROM game_scores WHERE game_id = $1`, [gameId])).toHaveLength(0);
  });

  it("reads the score once the game is taught", async () => {
    const gameId = await taughtGame();
    const res = await preview(josh, gameId, krillion(90, 512));
    expect(res.body.preview).toMatchObject({
      parseStatus: "score",
      scoreValue: 512,
      teach: { hasParser: true },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the day the same text was already posted", async () => {
    const gameId = await taughtGame();
    await post(josh, gameId, day(1), krillion(89, 500));
    const res = await preview(josh, gameId, krillion(89, 500), today);
    expect(res.body.preview.teach?.sameTextPeriodKey).toBe(day(1));
    // Re-posting to the same day is not a duplicate of another day.
    const same = await preview(josh, gameId, krillion(89, 500), day(1));
    expect(same.body.preview.teach?.sameTextPeriodKey).toBeNull();
  });

  it("warns when the text positively matches a different game", async () => {
    const gameId = await taughtGame();
    const dailyTens = "DailyTens #412\n\n  🏆   ❌\n  🏆   🏆\nhttps://dailytens.com/?ref=1";
    const res = await preview(josh, gameId, dailyTens);
    expect(res.body.preview.teach?.wrongGame?.game.title).toBe("Daily Tens");
    // "Doesn't look like this game" alone is never a warning.
    const junk = await preview(josh, gameId, "12 points today");
    expect(junk.body.preview.teach?.wrongGame).toBeNull();
  });
});

describe("the share-flow preview — text with no game", () => {
  it("recognises the game and previews the post against it", async () => {
    const mini =
      "I solved the 10/6/2026 New York Times Mini Crossword in 0:42!\nhttps://www.nytimes.com/crosswords/game/mini";
    const res = await call<SharePreviewResponse>(josh, "POST", "/score-preview", {
      scoreRaw: mini,
      periodKey: today,
    });
    expect(res.status).toBe(200);
    expect(res.body.match?.game.title).toBe("NYT Mini");
    expect(res.body.preview).toMatchObject({ parseStatus: "score", scoreValue: 42 });
  });

  it("returns no match rather than an error for text it cannot place", async () => {
    const res = await call<SharePreviewResponse>(josh, "POST", "/score-preview", {
      scoreRaw: "12 points today",
      periodKey: today,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ match: null, preview: null });
  });

  it("applies the edge-input gate", async () => {
    const res = await call<{ details: unknown }>(josh, "POST", "/score-preview", {
      scoreRaw: "https://dailytens.com/?ref=944415",
      periodKey: today,
    });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual({ code: "SCORE_INPUT_REJECTED", reason: "url_only" });
  });
});

describe("candidates — step 1 labels", () => {
  it("returns the model's role labels and the candidate to pre-select", async () => {
    const gameId = await newGame();
    // Candidates are numbered in the order the server lists them: 1 is the
    // puzzle number, 2 the score line; 99 names nothing.
    llm.targets = { score: 2, puzzle_number: [1, 99] };
    const res = await call<ScoreCandidatesResponse>(josh, "POST", `/${gameId}/scores/candidates`, {
      scoreRaw: krillion(81, 415),
    });
    expect(res.body.labelled).toBe(true);
    expect(res.body.scoreId).toBe(`number@${SCORE_AT}`);
    expect(res.body.roles).toEqual({
      "number@10": "puzzle_number",
      [`number@${SCORE_AT}`]: "score",
    });
    // The model is told the candidates; it never supplies one.
    expect(llm.calls[0]?.input).toContain('1. number = 81 (shown as "81")');
  });

  it("falls back to unlabelled candidates when the model is down or slow", async () => {
    const gameId = await newGame();
    for (const fail of ["http", "timeout"] as const) {
      llm.fail = fail;
      const res = await call<ScoreCandidatesResponse>(
        josh,
        "POST",
        `/${gameId}/scores/candidates`,
        { scoreRaw: krillion(81, 415) },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ labelled: false, roles: {}, scoreId: null });
      expect(res.body.candidates.length).toBeGreaterThan(0);
    }
  });

  it("drops a pre-selection that is not one of the computed candidates", async () => {
    const gameId = await newGame();
    llm.targets = { score: 99, puzzle_number: [] };
    const res = await call<ScoreCandidatesResponse>(josh, "POST", `/${gameId}/scores/candidates`, {
      scoreRaw: krillion(81, 415),
    });
    expect(res.body.scoreId).toBeNull();
  });
});

describe("posting with a pick", () => {
  it("stores the picked candidate's computed value as the player's own score", async () => {
    const gameId = await newGame();
    const res = await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    expect(res.status).toBe(200);
    expect(res.body.score).toMatchObject({
      scoreValue: 415,
      parseStatus: "score",
      scoreSource: "picked",
      // No parser read this text, so there is nothing for the pick to differ from.
      adjusted: false,
    });
    expect(res.body.teach).toEqual({
      eligible: true,
      needsDirection: true,
      suggestedDirection: "desc",
    });
    expect(await scoreRow(gameId, josh, today)).toMatchObject({
      score_source: "picked",
      pick_is_example: true,
      code_version: 0,
    });
    // Storing a pick never calls the model.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a pick that is not a candidate in the text — no client-supplied values", async () => {
    const gameId = await newGame();
    const res = await post(josh, gameId, today, krillion(81, 415), {
      pick: { kind: "feature", featureId: "number@999" },
    });
    expect(res.status).toBe(400);
    const smuggled = await post(josh, gameId, today, krillion(81, 415), {
      pick: { kind: "feature", featureId: "number@10", value: 9999 },
    });
    expect(smuggled.body.score.scoreValue).toBe(81);
  });

  it(`stores "I didn't finish" as a no-result that is never labelled adjusted`, async () => {
    const gameId = await taughtGame();
    const res = await post(josh, gameId, today, krillion(82, 0), { pick: { kind: "no_result" } });
    expect(res.body.score).toMatchObject({
      parseStatus: "no_result",
      scoreValue: null,
      adjusted: false,
    });
    // The parser reads a score here, so this fixes only the player's own row.
    expect(res.body.teach?.eligible).toBe(false);
  });

  it("does not make a pick a training example when the text does not name the game", async () => {
    const gameId = await newGame();
    const res = await post(josh, gameId, today, "#81\n415", {
      pick: { kind: "feature", featureId: "number@4" },
    });
    expect(res.body.score).toMatchObject({ scoreValue: 415, scoreSource: "picked" });
    expect(res.body.teach?.eligible).toBe(false);
    expect((await scoreRow(gameId, josh, today)).pick_is_example).toBe(false);
    const taught = await teach(josh, gameId, today);
    expect(taught.body.outcome).toBe("not_eligible");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("teaching the parser from a pick", () => {
  it("accepts code that passes every gate: new version, revision, direction, re-read, one ping", async () => {
    const gameId = await newGame();
    // Dag posted before anyone taught the game: unread.
    const earlier = await post(dag, gameId, day(1), krillion(80, 390));
    expect(earlier.body.score.parseStatus).toBe("failed");
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });

    llm.code = [READS_SCORE];
    const res = await teach(josh, gameId, today, { scoreDirection: "desc" });
    expect(res.body.outcome).toBe("accepted");
    expect(llm.calls).toHaveLength(1);

    const game = await gameRow(gameId);
    expect(game).toMatchObject({
      parse_code: READS_SCORE,
      code_version: 1,
      score_direction: "desc",
      direction_set_by: josh,
    });
    const [revision] = await rows<{
      version: number;
      source: string;
      authored_by: string;
      examples: { raw: string; expected: number }[];
    }>(`SELECT * FROM game_code_revisions WHERE game_id = $1`, [gameId]);
    expect(revision).toMatchObject({ version: 1, source: "teach", authored_by: josh });
    expect(revision?.examples[0]).toMatchObject({ raw: krillion(81, 415), expected: 415 });

    // Dag's unread row in the window is re-read by the new code.
    expect(await scoreRow(gameId, dag, day(1))).toMatchObject({
      score_value: "390",
      parse_status: "score",
      code_version: 1,
    });
    // Josh's own row is his pick, no longer at odds with the parser.
    expect(await scoreRow(gameId, josh, today)).toMatchObject({
      score_source: "picked",
      pick_adjusted: false,
    });

    expect(teachPings()).toHaveLength(1);
    expect(teachPings()[0]?.[0]).toContain('Josh taught "Krillion" → v1');
    expect(teachPings()[0]?.[0]).toContain("→ 415");
  });

  it("then reads ordinary posts with the stored code — no model call", async () => {
    const gameId = await taughtGame();
    const res = await post(dag, gameId, today, krillion(83, 222));
    expect(res.body.score).toMatchObject({
      scoreValue: 222,
      parseStatus: "score",
      scoreSource: "parsed",
    });
    expect(res.body.teach).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(teachPings()).toHaveLength(0);
  });

  it("gives the write-code step the pick's derivation, the contract and the separator hint", async () => {
    const gameId = await newGame();
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [READS_SCORE];
    await teach(josh, gameId, today, { scoreDirection: "desc" });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      instructions: string;
      input: string;
      max_output_tokens: number;
    };
    expect(request.input).toContain('415: from "415" on line 2');
    expect(request.instructions).toContain(
      "Numbers in a share may contain thousands separators (1,000) and surrounding whitespace; handle them.",
    );
    expect(request.instructions).toContain("No-result rule");
    expect(request.max_output_tokens).toBeLessThanOrEqual(1000);
  });

  it("retries once with the gate failure fed back, and accepts the corrected code", async () => {
    const gameId = await newGame();
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [CONSTANT, READS_SCORE];
    const res = await teach(josh, gameId, today, { scoreDirection: "desc" });
    expect(res.body.outcome).toBe("accepted");
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.input).toContain("Your previous attempt was rejected");
    expect(llm.calls[1]?.input).toContain("parse must return 414 but it returned 415");
  });

  it("rejects overfit code after one retry: the pick still stands, the game is unchanged, no ping", async () => {
    const gameId = await newGame();
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [CONSTANT, CONSTANT, READS_SCORE];
    const res = await teach(josh, gameId, today, { scoreDirection: "desc" });
    expect(res.body.outcome).toBe("rejected");
    // Exactly one retry.
    expect(llm.calls).toHaveLength(2);
    expect(await gameRow(gameId)).toMatchObject({ parse_code: null, code_version: 0 });
    expect(await scoreRow(gameId, josh, today)).toMatchObject({
      score_value: "415",
      score_source: "picked",
    });
    expect(await rows(`SELECT 1 FROM game_code_revisions WHERE game_id = $1`, [gameId])).toEqual(
      [],
    );
    expect(teachPings()).toHaveLength(0);
  });

  it("fails soft when the model is down or slow: unavailable, pick kept, game unchanged", async () => {
    for (const fail of ["http", "timeout"] as const) {
      const gameId = await newGame();
      await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
      llm.fail = fail;
      const res = await teach(josh, gameId, today, { scoreDirection: "desc" });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("unavailable");
      expect(res.body.score).toMatchObject({ scoreValue: 415, scoreSource: "picked" });
      expect((await gameRow(gameId)).code_version).toBe(0);
    }
    expect(teachPings()).toHaveLength(0);
  });

  it("does nothing when the parser already reads the pick", async () => {
    const gameId = await taughtGame();
    await post(dag, gameId, today, krillion(83, 222), { pick: scorePick });
    const res = await teach(dag, gameId, today);
    expect(res.body.outcome).toBe("not_needed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only rewrites stored scores of accounts teach is on for", async () => {
    const gameId = await newGame();
    // Legacy path: stored 80 by the first-number fallback.
    await post(outsider, gameId, day(1), krillion(80, 390));
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [READS_SCORE];
    expect((await teach(josh, gameId, today, { scoreDirection: "desc" })).body.outcome).toBe(
      "accepted",
    );
    expect(await scoreRow(gameId, outsider, day(1))).toMatchObject({
      score_value: "80",
      parse_status: null,
    });
  });
});

describe("one user's teach cannot move another user's read score", () => {
  it("rejects code that regresses a read row, even when another user's old pick still parses", async () => {
    const gameId = await taughtGame();
    // Dag confirmed a score the current parser already reads; Paloma's row
    // was simply read. Neither asked for anything to change.
    await post(dag, gameId, day(2), krillion(84, 333), { pick: scorePick });
    const readRaw = `${krillion(85, 290)}\nstreak 12`;
    const read = await post(paloma, gameId, day(1), readRaw);
    expect(read.body.score).toMatchObject({ scoreValue: 290, scoreSource: "parsed" });

    // Josh corrects a new format; the model's code misreads Paloma's share.
    const total = "Krillion #86 🦐\nTotal 501\n\n🦑🏮🫧🦑🫧🏮";
    await post(josh, gameId, today, total, {
      pick: { kind: "feature", featureId: `number@${"Krillion #86 🦐\nTotal ".length}` },
    });
    llm.code = [READS_LAST_NUMBER, READS_LAST_NUMBER];
    const res = await teach(josh, gameId, today);

    expect(res.body.outcome).toBe("rejected");
    // Not a switch on the first attempt: the gate failure went back for the retry.
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.input).toContain("parse must return 290 but it returned 12");
    expect(await gameRow(gameId)).toMatchObject({ parse_code: READS_SCORE, code_version: 1 });
    expect(await scoreRow(gameId, paloma, day(1))).toMatchObject({
      score_value: "290",
      code_version: 1,
    });
    expect(await scoreRow(gameId, josh, today)).toMatchObject({ score_value: "501" });
    expect(teachPings()).toHaveLength(0);
  });
});

describe("the global daily model budget", () => {
  const spendBudget = () =>
    rows(
      `INSERT INTO rate_limits (bucket_key, window_start, count)
       VALUES ('teach.llm.global', date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc', 500)`,
    );

  it("stops teaching once it is spent: the pick stands, no model call is made", async () => {
    const gameId = await newGame();
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    await spendBudget();
    llm.code = [READS_SCORE];
    const res = await teach(josh, gameId, today, { scoreDirection: "desc" });
    expect(res.body.outcome).toBe("unavailable");
    expect(res.body.score).toMatchObject({ scoreValue: 415, scoreSource: "picked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the picker's chips unlabelled once it is spent", async () => {
    const gameId = await newGame();
    await spendBudget();
    llm.targets = { score: 2, puzzle_number: [1] };
    const res = await call<ScoreCandidatesResponse>(josh, "POST", `/${gameId}/scores/candidates`, {
      scoreRaw: krillion(81, 415),
    });
    expect(res.body.labelled).toBe(false);
    expect(res.body.candidates.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts every model call, both steps", async () => {
    const gameId = await newGame();
    llm.targets = { score: 2, puzzle_number: [1] };
    await call(josh, "POST", `/${gameId}/scores/candidates`, { scoreRaw: krillion(81, 415) });
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [CONSTANT, READS_SCORE];
    await teach(josh, gameId, today, { scoreDirection: "desc" });
    const [bucket] = await rows<{ count: number }>(
      `SELECT count FROM rate_limits WHERE bucket_key = 'teach.llm.global'`,
    );
    expect(bucket?.count).toBe(3);
  });
});

describe("two matching corrections against a parser nobody confirmed", () => {
  /** A game whose code was seeded (not taught): it reads the puzzle number. */
  async function seededGame(): Promise<string> {
    const gameId = await newGame();
    await rows(`UPDATE games SET parse_code = $2, code_version = 1 WHERE id = $1`, [
      gameId,
      READS_PUZZLE_NUMBER,
    ]);
    await rows(
      `INSERT INTO game_code_revisions (game_id, version, parse_code, source, note)
       VALUES ($1, 1, $2, 'seed', 'seeded for the test')`,
      [gameId, READS_PUZZLE_NUMBER],
    );
    return gameId;
  }

  it("rejects the first correction and switches on the second, re-reading only what the outvoted version read", async () => {
    const gameId = await seededGame();
    // Josh's row was read by the seeded parser (version 1): the puzzle number.
    const read = await post(josh, gameId, day(3), krillion(82, 401));
    expect(read.body.score).toMatchObject({ scoreValue: 82, scoreSource: "parsed" });
    // And one of his older rows was read by an earlier version of the code.
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, parse_status, score_source, code_version)
       VALUES ($1, $2, $3, $4, 77, 'score', 'parsed', 0)`,
      [gameId, josh, day(6), krillion(77, 350)],
    );

    // First correction: Dag says the score line is the score.
    const first = await post(dag, gameId, day(2), krillion(84, 333), { pick: scorePick });
    expect(first.body.score).toMatchObject({ scoreValue: 333, adjusted: true });
    llm.code = [READS_SCORE];
    expect((await teach(dag, gameId, day(2))).body.outcome).toBe("rejected");
    expect(await gameRow(gameId)).toMatchObject({
      parse_code: READS_PUZZLE_NUMBER,
      code_version: 1,
    });
    expect(await scoreRow(gameId, josh, day(3))).toMatchObject({ score_value: "82" });
    // Nobody's pick was contradicted, so the game is not flagged.
    expect((await gameRow(gameId)).parse_conflict_at).toBeNull();
    expect(teachPings()).toHaveLength(0);

    // Second, matching correction: Paloma.
    await post(paloma, gameId, day(1), krillion(85, 290), { pick: scorePick });
    llm.code = [READS_SCORE];
    const res = await teach(paloma, gameId, day(1));
    expect(res.body.outcome).toBe("switched");

    expect(await gameRow(gameId)).toMatchObject({ parse_code: READS_SCORE, code_version: 2 });
    const [revision] = await rows<{ source: string; authored_by: string; note: string }>(
      `SELECT source, authored_by, note FROM game_code_revisions WHERE game_id = $1 AND version = 2`,
      [gameId],
    );
    expect(revision).toMatchObject({ source: "teach", authored_by: paloma });
    // The row the outvoted version read is re-read by the new code…
    expect(await scoreRow(gameId, josh, day(3))).toMatchObject({
      score_value: "401",
      code_version: 2,
      score_source: "parsed",
    });
    // …the row an earlier version read keeps what it holds…
    expect(await scoreRow(gameId, josh, day(6))).toMatchObject({
      score_value: "77",
      code_version: 0,
    });
    // …and both correctors' own picks keep their values, no longer adjusted.
    expect(await scoreRow(gameId, dag, day(2))).toMatchObject({
      score_value: "333",
      score_source: "picked",
      pick_adjusted: false,
    });
    expect(await scoreRow(gameId, paloma, day(1))).toMatchObject({
      score_value: "290",
      score_source: "picked",
      pick_adjusted: false,
    });
    // Announced like any accepted teach, with the count of rows it changed.
    expect(teachPings()).toHaveLength(1);
    expect(teachPings()[0]?.[0]).toContain('Paloma switched "Krillion" → v2 (1 re-read)');
  });

  it("does not switch when the same user corrects twice", async () => {
    const gameId = await seededGame();
    await post(josh, gameId, day(3), krillion(82, 401));
    await post(dag, gameId, day(2), krillion(84, 333), { pick: scorePick });
    llm.code = [READS_SCORE];
    expect((await teach(dag, gameId, day(2))).body.outcome).toBe("rejected");
    await post(dag, gameId, day(1), krillion(85, 290), { pick: scorePick });
    llm.code = [READS_SCORE];
    expect((await teach(dag, gameId, day(1))).body.outcome).toBe("rejected");
    expect((await gameRow(gameId)).code_version).toBe(1);
    expect(await scoreRow(gameId, josh, day(3))).toMatchObject({ score_value: "82" });
  });
});

describe("conflicting picks and the second agreeing user", () => {
  it("keeps the corrector's value, flags the game and changes nothing on a conflict", async () => {
    const gameId = await taughtGame();
    // Dag says the puzzle number is the score — against Josh's confirmed pick.
    const posted = await post(dag, gameId, day(1), krillion(84, 333), { pick: puzzlePick });
    expect(posted.body.score).toMatchObject({
      scoreValue: 84,
      scoreSource: "picked",
      adjusted: true,
    });
    llm.code = [READS_PUZZLE_NUMBER];
    const res = await teach(dag, gameId, day(1));
    expect(res.body.outcome).toBe("conflict");
    // The parser said the pick is wrong for this shape: no retry to argue it.
    expect(llm.calls).toHaveLength(1);

    const game = await gameRow(gameId);
    expect(game).toMatchObject({ parse_code: READS_SCORE, code_version: 1 });
    expect(game.parse_conflict_at).not.toBeNull();
    expect(await scoreRow(gameId, dag, day(1))).toMatchObject({
      score_value: "84",
      pick_adjusted: true,
    });
    expect(teachPings()).toHaveLength(0);
  });

  it("switches when a second user agrees: outvoted rows are re-read, own picks keep their value", async () => {
    const gameId = await taughtGame();
    // Read by version 1 (the score line), on another day.
    await post(josh, gameId, day(3), krillion(82, 401));
    await post(dag, gameId, day(1), krillion(84, 333), { pick: puzzlePick });
    llm.code = [READS_PUZZLE_NUMBER];
    expect((await teach(dag, gameId, day(1))).body.outcome).toBe("conflict");

    await post(paloma, gameId, today, krillion(85, 290), { pick: puzzlePick });
    llm.code = [READS_PUZZLE_NUMBER];
    const res = await teach(paloma, gameId, today);
    expect(res.body.outcome).toBe("switched");

    const game = await gameRow(gameId);
    expect(game).toMatchObject({ parse_code: READS_PUZZLE_NUMBER, code_version: 2 });
    expect(game.parse_conflict_at).toBeNull();
    // Josh's row read by the outvoted version is re-read by the new one…
    expect(await scoreRow(gameId, josh, day(3))).toMatchObject({
      score_value: "82",
      code_version: 2,
      score_source: "parsed",
    });
    // …his own pick keeps its value, now shown as adjusted, and stops being an example.
    expect(await scoreRow(gameId, josh, day(5))).toMatchObject({
      score_value: "415",
      score_source: "picked",
      pick_adjusted: true,
      pick_is_example: false,
    });
    expect(await scoreRow(gameId, dag, day(1))).toMatchObject({ pick_adjusted: false });
    expect(teachPings()).toHaveLength(1);
    expect(teachPings()[0]?.[0]).toContain('Paloma switched "Krillion" → v2');
  });

  it("lets a user overturn their own earlier pick without a second user", async () => {
    const gameId = await newGame();
    await post(josh, gameId, day(1), krillion(80, 390), { pick: puzzlePick });
    llm.code = [READS_PUZZLE_NUMBER];
    expect((await teach(josh, gameId, day(1), { scoreDirection: "desc" })).body.outcome).toBe(
      "accepted",
    );
    await post(josh, gameId, today, krillion(81, 415), { pick: scorePick });
    llm.code = [READS_SCORE];
    expect((await teach(josh, gameId, today)).body.outcome).toBe("accepted");
    expect(await scoreRow(gameId, josh, day(1))).toMatchObject({
      score_value: "80",
      pick_is_example: false,
      pick_adjusted: true,
    });
  });
});

describe("fix score — a pick on an existing row", () => {
  it("applies a pick to the caller's own row and nobody else's", async () => {
    const gameId = await newGame();
    await post(josh, gameId, today, krillion(81, 415));
    expect((await scoreRow(gameId, josh, today)).parse_status).toBe("failed");

    const res = await call<ApplyScorePickResponse>(
      josh,
      "POST",
      `/${gameId}/scores/${today}/pick`,
      {
        pick: scorePick,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.score).toMatchObject({
      scoreValue: 415,
      parseStatus: "score",
      scoreSource: "picked",
    });
    expect(res.body.teach.eligible).toBe(true);

    // Dag has no row for that day: there is no way to address Josh's.
    const other = await call(dag, "POST", `/${gameId}/scores/${today}/pick`, { pick: scorePick });
    expect(other.status).toBe(404);
  });
});

describe("standings", () => {
  it("orders scores by direction, then no-result in last place, then unread with no rank", async () => {
    const gameId = await taughtGame();
    await rows(
      `INSERT INTO friendships (user_low, user_high) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      [...[josh, dag].sort(), ...[josh, paloma].sort(), ...[dag, paloma].sort()],
    );
    await post(josh, gameId, today, krillion(90, 500));
    await post(dag, gameId, today, krillion(90, 0), { pick: { kind: "no_result" } });
    await post(paloma, gameId, today, "hi");

    const res = await call<{
      entries: { userId: string; rank: number | null; parseStatus: string }[];
    }>(josh, "GET", `/${gameId}/leaderboard?period=${today}`);
    expect(res.body.entries.map((e) => [e.userId, e.rank, e.parseStatus])).toEqual([
      [josh, 1, "score"],
      [dag, 2, "no_result"],
      [paloma, null, "failed"],
    ]);
  });

  it("marks a picked score adjusted while the parser disagrees", async () => {
    const gameId = await taughtGame();
    await post(josh, gameId, today, krillion(90, 500), { pick: puzzlePick });
    const res = await call<{ entries: { adjusted: boolean; scoreValue: number }[] }>(
      josh,
      "GET",
      `/${gameId}/leaderboard?period=${today}`,
    );
    expect(res.body.entries[0]).toMatchObject({ scoreValue: 90, adjusted: true });
  });
});

describe("score direction — the two-user rule", () => {
  const setDirection = (asUser: string, gameId: string, scoreDirection: "asc" | "desc") =>
    call<SetScoreDirectionResponse>(asUser, "PUT", `/${gameId}/score-direction`, {
      scoreDirection,
    });

  it("lets the user who set it change it, and holds anyone else's change for a second user", async () => {
    const gameId = await taughtGame();
    expect((await setDirection(dag, gameId, "asc")).body).toMatchObject({ applied: false });
    expect((await gameRow(gameId)).score_direction).toBe("desc");

    const second = await setDirection(paloma, gameId, "asc");
    expect(second.body.applied).toBe(true);
    expect(second.body.game.scoreDirection).toBe("asc");
    expect(discord.mock.calls.filter(([, o]) => o?.kind === "direction_changed")).toHaveLength(1);
  });

  it("applies the setter's own change at once", async () => {
    const gameId = await taughtGame();
    const res = await setDirection(josh, gameId, "asc");
    expect(res.body.applied).toBe(true);
    expect((await gameRow(gameId)).score_direction).toBe("asc");
  });
});

describe("rollback", () => {
  it("restores a prior version as a new revision, operator only", async () => {
    const gameId = await taughtGame();
    await post(josh, gameId, today, krillion(81, 415), { pick: puzzlePick });
    llm.code = [READS_PUZZLE_NUMBER];
    // Josh overturning his own pick: version 2.
    await rows(`DELETE FROM game_scores WHERE game_id = $1 AND period_key = $2`, [gameId, day(5)]);
    expect((await teach(josh, gameId, today)).body.outcome).toBe("accepted");
    expect((await gameRow(gameId)).code_version).toBe(2);

    expect((await call(dag, "POST", `/${gameId}/parser/rollback`, { version: 1 })).status).toBe(
      404,
    );
    const res = await call(josh, "POST", `/${gameId}/parser/rollback`, { version: 1 });
    expect(res.status).toBe(200);
    expect(await gameRow(gameId)).toMatchObject({ parse_code: READS_SCORE, code_version: 3 });
    const revisions = await rows<{ version: number; source: string; note: string }>(
      `SELECT version, source, note FROM game_code_revisions WHERE game_id = $1 ORDER BY version`,
      [gameId],
    );
    expect(revisions.map((r) => [r.version, r.source])).toEqual([
      [1, "teach"],
      [2, "teach"],
      [3, "operator"],
    ]);
    expect(revisions[2]?.note).toBe("rollback to version 1");
    // The rollback is a log event, not a ping.
    expect(teachPings()).toHaveLength(1);
  });
});
