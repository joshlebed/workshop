// PROTOTYPE — generated share formatters, end to end on PGlite with the real
// sandbox and the model mocked at the `fetch` boundary: the flags, the
// formatter-preview routes, and teach's GAME_TEACH_FORMAT path.

import { PGlite } from "@electric-sql/pglite";
import type {
  FormatterPreviewResponse,
  FormatterSuggestResponse,
  GamesResponse,
  SetFormatterResponse,
  TeachParserResponse,
} from "@workshop/shared/games";
import { shiftPeriodKey } from "@workshop/shared/games";
import type { ScorePick } from "@workshop/shared/scoreCandidates";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { shutdownGameCodeSandbox } from "../../lib/gameCode/runtime.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;
vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));
vi.mock("../../lib/discord.js", () => ({ notifyDiscord: () => Promise.resolve() }));

import { gameRoutes } from "./games.js";

// Games beta accounts (teach on whatever the flag says); Josh is an admin.
const josh = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";
const dag = "a75a758c-e3cd-46a4-ae0e-7f4e67ea1c5e";
const today = new Date().toISOString().slice(0, 10);
const day = (ago: number) => shiftPeriodKey(today, -ago);

const krillion = (puzzle: number, score: number) =>
  `Krillion #${puzzle} 🦐\n${score}\n\n🦑🏮🫧🦑🫧🏮\nhttps://krillion.io`;
const SCORE_AT = "Krillion #81 🦐\n".length;
const scorePick: ScorePick = { kind: "feature", featureId: `number@${SCORE_AT}` };
const READS_SCORE = `function parse(raw) {
  var m = raw.match(/^\\s*([\\d,]+)\\s*$/m);
  if (!m) throw new Error("no score line");
  return Number(m[1].replace(/,/g, ""));
}`;
const GOOD_FORMAT = `function format(raw) {
  var grid = raw.split(/\\r?\\n/).filter(function (l) { return /^[🦑🏮🫧🐟]+$/u.test(l.trim()); });
  return grid.length ? "🦐 " + grid.join("") : null;
}`;
const LONG_FORMAT = `function format(raw) { return "a\\nb\\nc\\nd\\ne\\nf\\ng"; }`;

const llm = { code: [] as string[], format: null as string | null, schemas: [] as string[] };
const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { text: { format: { name: string } } };
  const schema = body.text.format.name;
  llm.schemas.push(schema);
  const answer =
    schema === "score_parser"
      ? { code: llm.code.shift() ?? READS_SCORE }
      : schema === "score_parser_and_format"
        ? { code: llm.code.shift() ?? READS_SCORE, format: llm.format ?? "" }
        : schema === "score_formatter"
          ? { format: llm.format ?? "" }
          : { score: null, puzzle_number: [], date: [], streak: [], percentile: [] };
  return Response.json({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  });
});

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function call<T>(asUser: string, method: string, path: string, body?: unknown) {
  const res = await gameRoutes.request(path, {
    method,
    headers: { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

let counter = 0;
async function newGame(): Promise<string> {
  counter += 1;
  const [row] = await rows<{ id: string }>(
    `INSERT INTO games (normalized_url, url, title) VALUES ($1, $2, 'Krillion') RETURNING id`,
    [`krillion${counter}.io`, `https://krillion${counter}.io`],
  );
  if (!row) throw new Error("insert failed");
  await rows(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2), ($3, $2)`, [
    josh,
    row.id,
    dag,
  ]);
  return row.id;
}

async function formatCodeOf(gameId: string) {
  const [row] = await rows<{ format_code: string | null; parse_code: string | null }>(
    `SELECT format_code, parse_code FROM games WHERE id = $1`,
    [gameId],
  );
  return row;
}

function setFlags(flags: { preview?: "on" | "off"; teachFormat?: "on" | "off" }) {
  process.env.GAME_FORMATTER_PREVIEW = flags.preview ?? "off";
  process.env.GAME_TEACH_FORMAT = flags.teachFormat ?? "off";
  resetConfigForTesting();
}

async function logged(kind: string, run: () => Promise<unknown>) {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
    try {
      const entry = JSON.parse(String(line)) as Record<string, unknown>;
      if (entry.kind === kind) lines.push(entry);
    } catch {
      // Not one of ours.
    }
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.OPENAI_API_KEY = "test-key";
  process.env.GAME_TEACH = "off";
  process.env.GAME_CODE_PARSING = "off";
  process.env.GAME_RECOGNITION = "off";
  delete process.env.DISCORD_NOTIFY_WEBHOOK_URL;
  delete process.env.TYPESAFE_API_KEY;
  resetConfigForTesting();
  vi.stubGlobal("fetch", fetchMock);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'), ($2, 'dag@example.com', 'Dag')`,
    [josh, dag],
  );
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.GAME_FORMATTER_PREVIEW;
  delete process.env.GAME_TEACH_FORMAT;
  resetConfigForTesting();
  await shutdownGameCodeSandbox();
});

beforeEach(async () => {
  await rows("DELETE FROM rate_limits");
  llm.code = [];
  llm.format = null;
  llm.schemas = [];
  setFlags({});
});

describe("flags (both default off)", () => {
  it("hides the capability and 404s every formatter route", async () => {
    const gameId = await newGame();
    const games = await call<GamesResponse>(josh, "GET", "/");
    expect(games.body.capabilities?.formatterPreview).toBeUndefined();
    for (const [method, path] of [
      ["POST", "preview"],
      ["POST", "suggest"],
      ["PUT", ""],
      ["POST", "reject"],
    ] as const) {
      const res = await call(josh, method, `/${gameId}/formatter${path ? `/${path}` : ""}`, {
        scoreRaw: krillion(81, 415),
        exampleRaw: krillion(81, 415),
        choice: "heuristic",
        shown: [],
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the preview flag on, offers the card; suggest only with GAME_TEACH_FORMAT", async () => {
    setFlags({ preview: "on" });
    let games = await call<GamesResponse>(josh, "GET", "/");
    expect(games.body.capabilities).toMatchObject({
      formatterPreview: true,
      formatterSuggest: false,
    });
    const gameId = await newGame();
    const suggest = await call(josh, "POST", `/${gameId}/formatter/suggest`, {
      scoreRaw: krillion(81, 415),
    });
    expect(suggest.status).toBe(404);
    setFlags({ preview: "on", teachFormat: "on" });
    games = await call<GamesResponse>(josh, "GET", "/");
    expect(games.body.capabilities?.formatterSuggest).toBe(true);
  });
});

describe("the formatter preview", () => {
  it("renders the heuristic over the paste and the caller's last two shares", async () => {
    setFlags({ preview: "on" });
    const gameId = await newGame();
    await rows(`UPDATE games SET parse_code = $2 WHERE id = $1`, [gameId, READS_SCORE]);
    for (const [ago, puzzle, score] of [
      [1, 80, 390],
      [2, 79, 300],
      [3, 78, 280],
    ] as const) {
      await rows(
        `INSERT INTO game_scores (game_id, user_id, period_key, score_raw) VALUES ($1, $2, $3, $4)`,
        [gameId, josh, day(ago), krillion(puzzle, score)],
      );
    }
    const res = await call<FormatterPreviewResponse>(josh, "POST", `/${gameId}/formatter/preview`, {
      scoreRaw: krillion(81, 415),
    });
    expect(res.status).toBe(200);
    expect(res.body.hasFormatter).toBe(false);
    expect(res.body.samples.map((s) => s.periodKey)).toEqual([null, day(1), day(2)]);
    expect(res.body.heuristic?.summaries).toEqual([
      "🦑🏮🫧🦑🫧🏮 415",
      "🦑🏮🫧🦑🫧🏮 390",
      "🦑🏮🫧🦑🫧🏮 300",
    ]);
    expect(res.body.samples[0]?.fallback).toBe("Krillion #81 🦐\n415\n🦑🏮🫧🦑🫧🏮");
  });

  it("'Looks good' stores the heuristic once; replacing it is admin-only", async () => {
    setFlags({ preview: "on" });
    const gameId = await newGame();
    const set = await call<SetFormatterResponse>(dag, "PUT", `/${gameId}/formatter`, {
      choice: "heuristic",
      exampleRaw: krillion(81, 415),
    });
    expect(set.status).toBe(200);
    expect(set.body.game.hasFormatter).toBe(true);
    expect((await formatCodeOf(gameId))?.format_code).toContain("__formatShareBodyHeuristic");
    const [revision] = await rows<{ source: string; authored_by: string; note: string }>(
      `SELECT source, authored_by, note FROM game_code_revisions WHERE game_id = $1`,
      [gameId],
    );
    expect(revision).toMatchObject({ source: "teach", authored_by: dag });

    const again = await call(dag, "PUT", `/${gameId}/formatter`, {
      choice: "heuristic",
      exampleRaw: krillion(81, 415),
    });
    expect(again.status).toBe(403);
    const admin = await call(josh, "PUT", `/${gameId}/formatter`, {
      choice: "heuristic",
      exampleRaw: krillion(81, 415),
    });
    expect(admin.status).toBe(200);

    // A game with a formatter has nothing to preview.
    const preview = await call<FormatterPreviewResponse>(
      dag,
      "POST",
      `/${gameId}/formatter/preview`,
      { scoreRaw: krillion(81, 415) },
    );
    expect(preview.body).toMatchObject({ hasFormatter: true, heuristic: null });
  });

  it("refuses a heuristic that renders nothing on the example", async () => {
    setFlags({ preview: "on" });
    const gameId = await newGame();
    const res = await call(dag, "PUT", `/${gameId}/formatter`, {
      choice: "heuristic",
      exampleRaw: "https://krillion.io",
    });
    expect(res.status).toBe(400);
    expect((await formatCodeOf(gameId))?.format_code).toBeNull();
  });

  it("suggests a gated model formatter, and stores it only with its token", async () => {
    setFlags({ preview: "on", teachFormat: "on" });
    const gameId = await newGame();
    llm.format = GOOD_FORMAT;
    const suggest = await call<FormatterSuggestResponse>(
      dag,
      "POST",
      `/${gameId}/formatter/suggest`,
      { scoreRaw: krillion(81, 415) },
    );
    expect(llm.schemas).toEqual(["score_formatter"]);
    const candidate = suggest.body.candidate;
    expect(candidate?.summaries).toEqual(["🦐 🦑🏮🫧🦑🫧🏮"]);
    if (!candidate) throw new Error("no candidate");

    const tampered = await call(dag, "PUT", `/${gameId}/formatter`, {
      choice: "llm",
      exampleRaw: krillion(81, 415),
      code: 'function format(raw) { return "pwned"; }',
      token: candidate.token,
    });
    expect(tampered.status).toBe(400);
    const stored = await call(dag, "PUT", `/${gameId}/formatter`, {
      choice: "llm",
      exampleRaw: krillion(81, 415),
      code: candidate.code,
      token: candidate.token,
    });
    expect(stored.status).toBe(200);
    expect((await formatCodeOf(gameId))?.format_code).toBe(GOOD_FORMAT);
  });

  it("drops a model formatter that fails the gate", async () => {
    setFlags({ preview: "on", teachFormat: "on" });
    const gameId = await newGame();
    llm.format = LONG_FORMAT;
    const suggest = await call<FormatterSuggestResponse>(
      dag,
      "POST",
      `/${gameId}/formatter/suggest`,
      { scoreRaw: krillion(81, 415) },
    );
    expect(suggest.body).toEqual({ candidate: null, reason: "too_many_lines" });
  });

  it("'Show raw' logs formatter_rejected and stores nothing", async () => {
    setFlags({ preview: "on" });
    const gameId = await newGame();
    const lines = await logged("formatter_rejected", () =>
      call(dag, "POST", `/${gameId}/formatter/reject`, {
        scoreRaw: krillion(81, 415),
        shown: ["heuristic"],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ game_id: gameId, user_id: dag, shown: ["heuristic"] });
    expect((await formatCodeOf(gameId))?.format_code).toBeNull();
  });
});

describe("teach with GAME_TEACH_FORMAT", () => {
  async function teachKrillion(gameId: string) {
    await call(josh, "PUT", `/${gameId}/scores`, {
      periodKey: today,
      scoreRaw: krillion(81, 415),
      pick: scorePick,
    });
    return call<TeachParserResponse>(josh, "POST", `/${gameId}/parser/teach`, {
      periodKey: today,
      scoreDirection: "desc",
    });
  }

  it("off (default): the old prompt, parse only", async () => {
    const gameId = await newGame();
    llm.format = GOOD_FORMAT;
    const res = await teachKrillion(gameId);
    expect(res.body.outcome).toBe("accepted");
    expect(llm.schemas).toContain("score_parser");
    expect(llm.schemas).not.toContain("score_parser_and_format");
    expect(await formatCodeOf(gameId)).toMatchObject({
      parse_code: READS_SCORE,
      format_code: null,
    });
  });

  it("on: one call writes both, and a gated formatter is stored with the parser", async () => {
    setFlags({ teachFormat: "on" });
    const gameId = await newGame();
    llm.format = GOOD_FORMAT;
    const lines = await logged("formatter_generated", async () => {
      const res = await teachKrillion(gameId);
      expect(res.body.outcome).toBe("accepted");
    });
    expect(llm.schemas).toContain("score_parser_and_format");
    expect(lines[0]).toMatchObject({ outcome: "accepted" });
    expect(await formatCodeOf(gameId)).toMatchObject({
      parse_code: READS_SCORE,
      format_code: GOOD_FORMAT,
    });
  });

  it("on: a formatter that fails the gate is dropped; the parser is still stored", async () => {
    setFlags({ teachFormat: "on" });
    const gameId = await newGame();
    llm.format = LONG_FORMAT;
    const res = await teachKrillion(gameId);
    expect(res.body.outcome).toBe("accepted");
    expect(await formatCodeOf(gameId)).toMatchObject({
      parse_code: READS_SCORE,
      format_code: null,
    });
  });
});
