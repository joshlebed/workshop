// The flag-gated write path for stored game code, against real SQL (PGlite
// with the actual migrations, so the seeded code is what runs) and the real
// sandbox. Covers the three modes, the beta allowlist, the new response
// fields, the preview endpoint, and the fail-soft guarantees.

import { PGlite } from "@electric-sql/pglite";
import type {
  GameLeaderboardResponse,
  GameScore,
  GamesResponse,
  PreviewGameScoreResponse,
} from "@workshop/shared/games";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { shutdownGameCodeSandbox } from "../../lib/gameCode/runtime.js";
import * as scoring from "../../lib/gameCode/scoring.js";
import { GAME_CODE_BUDGET_MS, scoreShareWithinBudget } from "../../lib/gameCodeService.js";
import { logger } from "../../lib/logger.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));

import { friendRoutes } from "./friends.js";
import { gameRoutes } from "./games.js";

const userId = "00000000-0000-4000-8000-0000000000c1";
const friendId = "00000000-0000-4000-8000-0000000000c2";
// On the Games beta allowlist (lib/gamesBeta.ts): code parsing is on for this
// account whatever GAME_CODE_PARSING says.
const betaUserId = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";
// ADMIN_EMAILS address — may re-teach a game through PUT /:id/score-spec.
const adminUserId = "00000000-0000-4000-8000-0000000000ad";

const DAY = "2026-10-01";
const WORLDLE =
  "#Worldle #1663 (11.08.2026) 5/6 (100%)\n🔥 Current Win Streak: 1 days\n🟩🟩⬜⬜⬜↘️\n🟩🟨⬜⬜⬜↙️\n🟩🟩🟩⬜⬜⬆️\n🟩🟩🟩🟩⬜➡️\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr";
const WORLDLE_SUMMARY = "🟩 2·1·3·4·5 5/6";
const TRADLE_LOSS = "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟨\nhttps://tradle.net/";
const KRILLION = "Krillion #81 🦐\n415\n\n🦑🫧🏮🐟🦑🦑🫧";

function authHeaders(asUser = userId): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

function setMode(mode: "off" | "shadow" | "on" | undefined) {
  if (mode === undefined) delete process.env.GAME_CODE_PARSING;
  else process.env.GAME_CODE_PARSING = mode;
  resetConfigForTesting();
}

async function gameIdFor(key: string): Promise<string> {
  const [row] = await rows<{ id: string }>("SELECT id FROM games WHERE game_key = $1", [key]);
  if (!row) throw new Error(`no seeded game ${key}`);
  return row.id;
}

async function addGame(url: string, asUser = userId): Promise<string> {
  const res = await gameRoutes.request("/", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ url }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { game: { id: string } }).game.id;
}

async function post(gameId: string, scoreRaw: string, asUser = userId, periodKey = DAY) {
  const res = await gameRoutes.request(`/${gameId}/scores`, {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey, scoreRaw }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { score: GameScore }).score;
}

interface StoredRow {
  score_value: string | null;
  parse_status: string | null;
  score_summary: string | null;
  code_version: number | null;
}

async function stored(gameId: string, asUser = userId, periodKey = DAY): Promise<StoredRow> {
  const [row] = await rows<StoredRow>(
    `SELECT score_value, parse_status, score_summary, code_version
       FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
    [gameId, asUser, periodKey],
  );
  if (!row) throw new Error("no stored score");
  return row;
}

async function sourceOf(gameId: string, asUser = userId, periodKey = DAY) {
  const [row] = await rows<{ score_source: string | null }>(
    "SELECT score_source FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = $3",
    [gameId, asUser, periodKey],
  );
  return row?.score_source;
}

function shadowLines(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls
    .filter((call) => call[0] === "game code shadow")
    .map((call) => call[1] as Record<string, unknown>);
}

let worldle: string;
let tradle: string;

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'code-tester@example.com', 'Code Tester'),
       ($2, 'code-friend@example.com', 'Code Friend'),
       ($3, 'beta@example.com', 'Beta Tester'),
       ($4, 'joshlebed@gmail.com', 'Admin User')`,
    [userId, friendId, betaUserId, adminUserId],
  );
  // Friends, so each sees the others' standings rows.
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2), ($3, $4), ($5, $6)`, [
    ...[userId, friendId].sort(),
    ...[userId, betaUserId].sort(),
    ...[friendId, betaUserId].sort(),
  ]);
  worldle = await gameIdFor("worldle");
  tradle = await gameIdFor("tradle");
}, 60_000);

afterEach(async () => {
  setMode(undefined);
  vi.restoreAllMocks();
  await rows("DELETE FROM game_scores");
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

describe("GAME_CODE_PARSING=off (the default)", () => {
  it("stores the legacy parser's value and nothing else; the response has no new fields", async () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const run = vi.spyOn(scoring, "scoreWithGameCode");

    const score = await post(worldle, WORLDLE);

    // The legacy Worldle regex has no room for the date: still unparsed.
    expect(score.scoreValue).toBe(null);
    expect("parseStatus" in score).toBe(false);
    expect("scoreSummary" in score).toBe(false);
    expect(await stored(worldle)).toEqual({
      score_value: null,
      parse_status: null,
      score_summary: null,
      code_version: null,
    });
    // Nothing ran and nothing was logged.
    expect(run).not.toHaveBeenCalled();
    expect([...shadowLines(info), ...shadowLines(warn)]).toEqual([]);
  });

  it("keeps the first-number fallback for a game nobody has taught", async () => {
    const krillion = await addGame("https://krillion.io");
    expect((await post(krillion, KRILLION)).scoreValue).toBe(81);
  });

  it("reports the capability as off and 404s the preview", async () => {
    const res = await gameRoutes.request("/", { headers: authHeaders() });
    expect(((await res.json()) as GamesResponse).capabilities?.codeParsing).toBe(false);
    const preview = await gameRoutes.request(`/${worldle}/scores/preview`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ scoreRaw: WORLDLE }),
    });
    expect(preview.status).toBe(404);
  });
});

describe("GAME_CODE_PARSING=shadow", () => {
  it("runs the stored code and logs the disagreement, but stores and returns what off does", async () => {
    setMode("shadow");
    const warn = vi.spyOn(logger, "warn");

    const score = await post(worldle, WORLDLE);

    expect(score.scoreValue).toBe(null);
    expect("parseStatus" in score).toBe(false);
    expect(await stored(worldle)).toEqual({
      score_value: null,
      parse_status: null,
      score_summary: null,
      code_version: null,
    });
    const [line] = shadowLines(warn);
    expect(line).toMatchObject({
      kind: "game_code_shadow",
      mode: "shadow",
      user_id: userId,
      game_id: worldle,
      game_key: "worldle",
      period_key: DAY,
      code_version: 1,
      legacy_value: null,
      code_status: "score",
      code_value: 5,
      outcome: "disagree",
      change: "null_to_score",
      failure_reason: null,
      format: "summary",
      capped: false,
      raw_length: WORLDLE.length,
    });
    // The share text itself never reaches the logs.
    expect(JSON.stringify(line)).not.toContain("Worldle");
  });

  it("logs agreement at info when both parsers read the same thing", async () => {
    setMode("shadow");
    const info = vi.spyOn(logger, "info");
    await post(tradle, "#Tradle #1558 2/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟩\nhttps://tradle.net/");
    expect(shadowLines(info)[0]).toMatchObject({ outcome: "agree", change: "same_score" });
    await post(tradle, TRADLE_LOSS, friendId);
    expect(shadowLines(info)[1]).toMatchObject({
      outcome: "agree",
      change: "null_to_no_result",
      code_status: "no_result",
    });
  });

  it("does not serve the preview or the capability", async () => {
    setMode("shadow");
    const res = await gameRoutes.request("/", { headers: authHeaders() });
    expect(((await res.json()) as GamesResponse).capabilities?.codeParsing).toBe(false);
    const preview = await gameRoutes.request(`/${worldle}/scores/preview`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ scoreRaw: WORLDLE }),
    });
    expect(preview.status).toBe(404);
  });
});

describe("GAME_CODE_PARSING=on", () => {
  it("stores and returns the stored code's status, value and summary", async () => {
    setMode("on");
    const score = await post(worldle, WORLDLE);
    expect(score).toMatchObject({
      scoreValue: 5,
      parseStatus: "score",
      scoreSummary: WORLDLE_SUMMARY,
    });
    expect(await stored(worldle)).toEqual({
      score_value: "5",
      parse_status: "score",
      score_summary: WORLDLE_SUMMARY,
      code_version: 1,
    });
    // Read by the game's code, not picked by the poster.
    expect(await sourceOf(worldle)).toBe("parsed");
    // A legacy row has no source at all.
    setMode("off");
    await post(worldle, WORLDLE, friendId);
    expect(await sourceOf(worldle, friendId)).toBe(null);
  });

  it("keeps a loss, a failure and a score distinct — in storage, standings and ranks", async () => {
    setMode("on");
    await post(tradle, "#Tradle #1558 2/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟩\nhttps://tradle.net/");
    await post(tradle, TRADLE_LOSS, friendId);
    await post(tradle, "failed 12", betaUserId);

    expect(await stored(tradle, friendId)).toEqual({
      score_value: null,
      parse_status: "no_result",
      score_summary: "🟩 3·4 X/6",
      code_version: 1,
    });
    // "failed 12" is not a Tradle share: unranked, with the cleaned text —
    // never the 12.
    expect(await stored(tradle, betaUserId)).toEqual({
      score_value: null,
      parse_status: "failed",
      score_summary: "failed 12",
      code_version: 1,
    });

    const res = await gameRoutes.request(`/${tradle}/leaderboard?period=${DAY}`, {
      headers: authHeaders(),
    });
    const { entries } = (await res.json()) as GameLeaderboardResponse;
    const byUser = new Map(entries.map((e) => [e.userId, e]));
    expect(byUser.get(userId)).toMatchObject({
      rank: 1,
      scoreValue: 2,
      parseStatus: "score",
      scoreSummary: "🟩 3·5 2/6",
    });
    expect(byUser.get(friendId)).toMatchObject({
      rank: null,
      scoreValue: null,
      parseStatus: "no_result",
      scoreSummary: "🟩 3·4 X/6",
    });
    expect(byUser.get(betaUserId)).toMatchObject({
      rank: null,
      scoreValue: null,
      parseStatus: "failed",
      scoreSummary: "failed 12",
    });

    // GET /v1/games carries the same fields on its standings entries.
    const home = (await (
      await gameRoutes.request(`/?period=${DAY}`, { headers: authHeaders() })
    ).json()) as GamesResponse;
    const mine = home.games.find((g) => g.gameId === tradle)?.standings.entries;
    expect(mine?.find((e) => e.userId === friendId)).toMatchObject({ parseStatus: "no_result" });
    expect(home.capabilities?.codeParsing).toBe(true);
  });

  it("stores an untaught game's score as failed, not the first number in the text", async () => {
    setMode("on");
    const krillion = await addGame("https://krillion.io");
    const score = await post(krillion, KRILLION);
    expect(score).toMatchObject({
      scoreValue: null,
      parseStatus: "failed",
      scoreSummary: "Krillion #81 🦐\n415\n🦑🫧🏮🐟🦑🦑🫧",
    });
    expect((await stored(krillion)).code_version).toBe(0);
  });

  it("stores a null summary for a URL-only share", async () => {
    setMode("on");
    const dailyTens = await gameIdFor("dailytens");
    const score = await post(dailyTens, "https://dailytens.com/?ref=944415");
    expect(score).toMatchObject({ parseStatus: "failed", scoreSummary: null, scoreValue: null });
  });

  it("a re-post under a different mode clears the previous post's status and summary", async () => {
    setMode("on");
    await post(worldle, WORLDLE);
    expect((await stored(worldle)).parse_status).toBe("score");
    setMode("off");
    const score = await post(worldle, WORLDLE);
    expect("parseStatus" in score).toBe(false);
    expect(await stored(worldle)).toEqual({
      score_value: null,
      parse_status: null,
      score_summary: null,
      code_version: null,
    });
  });

  it("returns the fields on a friend's profile score", async () => {
    setMode("on");
    await post(worldle, WORLDLE, friendId);
    const res = await friendRoutes.request(`/users/${friendId}?period=${DAY}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: Array<{ game: { id: string }; score: Record<string, unknown> | null }>;
    };
    expect(body.games.find((g) => g.game.id === worldle)?.score).toMatchObject({
      scoreValue: 5,
      parseStatus: "score",
      scoreSummary: WORLDLE_SUMMARY,
    });
  });
});

describe("a registry game whose row did not exist when the seed migration ran", () => {
  it("is created with its code, so a beta account's first post to it is read", async () => {
    // Nobody had added Satle: no row for migration 0043 to seed.
    await rows("DELETE FROM games WHERE game_key = 'satle'");
    const satle = await addGame("https://satle.ca", betaUserId);
    expect(
      await rows(
        "SELECT game_key, code_version, parse_code IS NOT NULL AS coded FROM games WHERE id = $1",
        [satle],
      ),
    ).toEqual([{ game_key: "satle", code_version: 1, coded: true }]);
    expect(
      await rows("SELECT version, source FROM game_code_revisions WHERE game_id = $1", [satle]),
    ).toEqual([{ version: 1, source: "seed" }]);

    // The flag is off; the beta allowlist is what turns stored code on.
    const score = await post(satle, "🛰Satle #449 5/6\n🟥🟥🟥🟥🟩⬜\nhttps://satle.ca", betaUserId);
    expect(score).toMatchObject({
      parseStatus: "score",
      scoreValue: 5,
      scoreSummary: "🟥🟥🟥🟥🟩⬜ 5/6",
    });
    expect(await stored(satle, betaUserId)).toMatchObject({
      parse_status: "score",
      code_version: 1,
    });
  });
});

describe("Games beta accounts", () => {
  it("get stored-code parsing with the flag off; everyone else does not", async () => {
    const beta = await post(worldle, WORLDLE, betaUserId);
    const other = await post(worldle, WORLDLE, friendId);
    expect(beta).toMatchObject({ scoreValue: 5, parseStatus: "score" });
    expect(other.scoreValue).toBe(null);
    expect("parseStatus" in other).toBe(false);

    // One board, two kinds of row: clients fall back per row.
    const res = await gameRoutes.request(`/${worldle}/leaderboard?period=${DAY}`, {
      headers: authHeaders(),
    });
    const { entries } = (await res.json()) as GameLeaderboardResponse;
    const betaEntry = entries.find((e) => e.userId === betaUserId);
    const otherEntry = entries.find((e) => e.userId === friendId);
    expect(betaEntry).toMatchObject({ parseStatus: "score", scoreSummary: WORLDLE_SUMMARY });
    expect(otherEntry && "parseStatus" in otherEntry).toBe(false);
    expect(otherEntry?.scoreRaw).toBe(WORLDLE);
  });

  it("see the capability and can preview", async () => {
    const home = (await (
      await gameRoutes.request("/", { headers: authHeaders(betaUserId) })
    ).json()) as GamesResponse;
    expect(home.capabilities?.codeParsing).toBe(true);
    const res = await gameRoutes.request(`/${worldle}/scores/preview`, {
      method: "POST",
      headers: authHeaders(betaUserId),
      body: JSON.stringify({ scoreRaw: WORLDLE }),
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/games/:id/scores/preview", () => {
  async function preview(gameId: string, scoreRaw: string) {
    return gameRoutes.request(`/${gameId}/scores/preview`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ scoreRaw }),
    });
  }

  it("returns what a post would store, and stores nothing", async () => {
    setMode("on");
    const res = await preview(worldle, WORLDLE);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PreviewGameScoreResponse).preview).toEqual({
      parseStatus: "score",
      scoreValue: 5,
      scoreSummary: WORLDLE_SUMMARY,
    });
    const loss = (await (await preview(tradle, TRADLE_LOSS)).json()) as PreviewGameScoreResponse;
    expect(loss.preview).toEqual({
      parseStatus: "no_result",
      scoreValue: null,
      scoreSummary: "🟩 3·4 X/6",
    });
    const wrongGame = (await (await preview(tradle, WORLDLE)).json()) as PreviewGameScoreResponse;
    expect(wrongGame.preview.parseStatus).toBe("failed");
    expect(await rows("SELECT 1 FROM game_scores")).toEqual([]);
  });

  it("validates its input and 404s an unknown game", async () => {
    setMode("on");
    expect((await preview(worldle, "")).status).toBe(400);
    expect((await preview("00000000-0000-4000-8000-00000000dead", "x")).status).toBe(404);
  });
});

describe("the sandbox can never fail or hang a post", () => {
  const unavailableLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .filter((call) => call[0] === "game code unavailable for a score post")
      .map((call) => call[1] as Record<string, unknown>);

  it("keeps the legacy spec's reading when the sandbox — not the code — fails", async () => {
    setMode("on");
    vi.spyOn(scoring, "scoreWithGameCode").mockRejectedValue(new Error("sandbox exploded"));
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    const score = await post(tradle, "#Tradle #1558 2/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/");

    // A good value is not thrown away because of an infrastructure failure…
    expect(score.scoreValue).toBe(2);
    // …and the row is honest about where it came from: legacy-shaped (the
    // client formats it), with code_version 0 marking "code parsing was on,
    // the sandbox was not".
    expect("parseStatus" in score).toBe(false);
    expect(await stored(tradle)).toEqual({
      score_value: "2",
      parse_status: null,
      score_summary: null,
      code_version: 0,
    });
    expect(await sourceOf(tradle)).toBe(null);
    expect(unavailableLines(error)).toEqual([
      expect.objectContaining({
        kind: "game_code_unavailable",
        mode: "on",
        game_key: "tradle",
        failure_reason: "over_budget",
        stored: "legacy_spec_value",
        legacy_spec_value: 2,
      }),
    ]);
  });

  it("does the same when the sandbox answers that it is unavailable", async () => {
    setMode("on");
    vi.spyOn(scoring, "scoreWithGameCode").mockResolvedValue({
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "x",
      parse: { kind: "failed", reason: "sandbox_unavailable", detail: "worker did not start" },
      format: null,
    });
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    // A loss: the legacy spec reads "no number", and that is what is kept.
    const score = await post(tradle, TRADLE_LOSS);
    expect(score.scoreValue).toBe(null);
    expect(await stored(tradle)).toEqual({
      score_value: null,
      parse_status: null,
      score_summary: null,
      code_version: 0,
    });
    expect(unavailableLines(error)[0]).toMatchObject({
      failure_reason: "sandbox_unavailable",
      stored: "legacy_spec_value",
      legacy_spec_value: null,
    });
  });

  it("stores unread — never the first number — when the sandbox fails and the game has no legacy spec", async () => {
    setMode("on");
    const krillion = await addGame("https://no-spec-krill.example");
    await rows("UPDATE games SET parse_code = $1, code_version = 3 WHERE id = $2", [
      "function parse(raw) { return 415; }",
      krillion,
    ]);
    vi.spyOn(scoring, "scoreWithGameCode").mockRejectedValue(new Error("sandbox exploded"));
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    const score = await post(krillion, KRILLION);

    expect(score).toMatchObject({
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "Krillion #81 🦐\n415\n🦑🫧🏮🐟🦑🦑🫧",
    });
    expect((await stored(krillion)).code_version).toBe(3);
    expect(unavailableLines(error)[0]).toMatchObject({ stored: "unread", legacy_spec_value: null });
  });

  it("a failure of the CODE is still failed, even when the legacy spec could read the share", async () => {
    setMode("on");
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const [original] = await rows<{ parse_code: string }>(
      "SELECT parse_code FROM games WHERE id = $1",
      [tradle],
    );
    try {
      for (const broken of [
        `function parse(raw) { throw new Error("bug"); }`,
        `function parse(raw) { return "2"; }`,
        "function parse(raw) { for (;;) {} }",
      ]) {
        await rows("UPDATE games SET parse_code = $1 WHERE id = $2", [broken, tradle]);
        const score = await post(tradle, "#Tradle #1558 2/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/");
        // The legacy spec reads 2 here. It is not consulted: the game's code
        // gave its verdict, and the verdict is that it could not read this.
        expect(score, broken).toMatchObject({ parseStatus: "failed", scoreValue: null });
        expect((await stored(tradle)).code_version).toBe(1);
      }
    } finally {
      await rows("UPDATE games SET parse_code = $1 WHERE id = $2", [original?.parse_code, tradle]);
    }
    expect(unavailableLines(error)).toEqual([]);
  });

  it("gives up at the budget when scoring never answers", async () => {
    vi.spyOn(scoring, "scoreWithGameCode").mockReturnValue(new Promise(() => {}));
    const startedAt = Date.now();
    const scored = await scoreShareWithinBudget({ parseCode: "x", formatCode: null }, "12 pts", 60);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(scored).toMatchObject({
      capped: true,
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "12 pts",
      parse: { kind: "failed", reason: "sandbox_unavailable" },
    });
    // The budget a real post uses is well under the 15 s Lambda timeout.
    expect(GAME_CODE_BUDGET_MS).toBeLessThanOrEqual(2000);
  });

  it("a hung sandbox in shadow mode still stores the legacy value", async () => {
    setMode("shadow");
    vi.spyOn(scoring, "scoreWithGameCode").mockRejectedValue(new Error("sandbox exploded"));
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn");
    const score = await post(tradle, "#Tradle #1558 2/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/");
    expect(score.scoreValue).toBe(2);
    expect(shadowLines(warn)[0]).toMatchObject({ capped: true, change: "score_to_failed" });
  });

  it("stores failed, promptly, when a game's code never yields", async () => {
    setMode("on");
    const krillion = await addGame("https://krillion.io");
    await rows("UPDATE games SET parse_code = $1, code_version = 9 WHERE id = $2", [
      `function parse() { return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c"); }`,
      krillion,
    ]);
    const startedAt = Date.now();
    const score = await post(krillion, KRILLION);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(score).toMatchObject({ parseStatus: "failed", scoreValue: null });
    // The next post, to a healthy game, is unaffected.
    expect(await post(worldle, WORLDLE)).toMatchObject({ parseStatus: "score", scoreValue: 5 });
    await rows("UPDATE games SET parse_code = NULL, code_version = 0 WHERE id = $1", [krillion]);
  });
});

describe("PUT /v1/games/:id/score-spec also writes the game's code", () => {
  const spec = { rules: [{ kind: "capture", pattern: "🦐\\s*([\\d,]+(?:\\.\\d+)?)" }] };
  const summarySpec = { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] };

  async function teach(gameId: string, body: Record<string, unknown>, asUser = userId) {
    return gameRoutes.request(`/${gameId}/score-spec`, {
      method: "PUT",
      headers: authHeaders(asUser),
      body: JSON.stringify(body),
    });
  }

  it("stores compiled code, bumps the version and records a revision; posts then use it", async () => {
    const game = await addGame("https://taught-krill.example");
    const taught = await teach(game, {
      spec,
      exampleRaw: KRILLION,
      expectedValue: 415,
      scoreDirection: "desc",
      summarySpec,
    });
    expect(taught.status).toBe(200);
    // The catalog shape clients get is unchanged: code is never sent to them.
    const body = (await taught.json()) as { game: Record<string, unknown> };
    expect("parseCode" in body.game).toBe(false);

    const [row] = await rows<{ parse_code: string; format_code: string; code_version: number }>(
      "SELECT parse_code, format_code, code_version FROM games WHERE id = $1",
      [game],
    );
    expect(row?.code_version).toBe(1);
    expect(row?.parse_code.startsWith("var SPEC = ")).toBe(true);
    expect(row?.format_code.startsWith("var SPEC = ")).toBe(true);
    const revisions = await rows<{
      version: number;
      source: string;
      authored_by: string;
      examples: unknown;
    }>(
      "SELECT version, source, authored_by, examples FROM game_code_revisions WHERE game_id = $1",
      [game],
    );
    expect(revisions).toEqual([
      {
        version: 1,
        source: "spec",
        authored_by: userId,
        examples: [{ raw: KRILLION, expected: 415 }],
      },
    ]);

    setMode("on");
    expect(await post(game, KRILLION)).toMatchObject({
      parseStatus: "score",
      scoreValue: 415,
      scoreSummary: "415\n🦑🫧🏮🐟🦑🦑🫧",
    });
    expect((await stored(game)).code_version).toBe(1);
    // A share the taught rule does not match is failed — not its first number.
    expect(await post(game, "Krillion #82\nno score today", friendId)).toMatchObject({
      parseStatus: "failed",
      scoreValue: null,
    });
  });

  it("only an admin may teach over code an operator wrote, even though the game has no spec", async () => {
    const game = await addGame("https://operator-krill.example");
    const operatorCode = "function parse(raw) { return 415; }";
    await rows("UPDATE games SET parse_code = $1, code_version = 1 WHERE id = $2", [
      operatorCode,
      game,
    ]);
    const body = { spec, exampleRaw: KRILLION, expectedValue: 415, scoreDirection: "desc" };

    expect((await teach(game, body)).status).toBe(403);
    expect(await rows("SELECT parse_code, code_version FROM games WHERE id = $1", [game])).toEqual([
      { parse_code: operatorCode, code_version: 1 },
    ]);
    expect((await teach(game, body, adminUserId)).status).toBe(200);
    expect(
      await rows<{ code_version: number }>("SELECT code_version FROM games WHERE id = $1", [game]),
    ).toEqual([{ code_version: 2 }]);
  });

  it("an admin re-teach writes version 2 and clears format code with the summary spec", async () => {
    const game = await addGame("https://retaught-krill.example");
    await teach(game, {
      spec,
      exampleRaw: KRILLION,
      expectedValue: 415,
      scoreDirection: "desc",
      summarySpec,
    });
    const again = await teach(
      game,
      { spec, exampleRaw: KRILLION, expectedValue: 415, scoreDirection: "desc" },
      adminUserId,
    );
    expect(again.status).toBe(200);
    const [row] = await rows<{ format_code: string | null; code_version: number }>(
      "SELECT format_code, code_version FROM games WHERE id = $1",
      [game],
    );
    expect(row).toEqual({ format_code: null, code_version: 2 });
    expect(
      await rows("SELECT version, source FROM game_code_revisions WHERE game_id = $1 ORDER BY 1", [
        game,
      ]),
    ).toEqual([
      { version: 1, source: "spec" },
      { version: 2, source: "spec" },
    ]);
  });
});
