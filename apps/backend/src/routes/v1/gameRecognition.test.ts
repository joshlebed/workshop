// Route-level tests for game-score recognition: POST /v1/games/recognize and
// the shadow-mode log on score posts. Real SQL against PGlite (the candidate
// and example queries are the point); only the Jev call is stubbed.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import type { JudgeRequest, JudgeVerdict } from "../../lib/gameRecognition.js";
import { logger } from "../../lib/logger.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));

const judgeMock = vi.fn<(request: JudgeRequest) => Promise<JudgeVerdict | null>>();
vi.mock("../../lib/jev.js", () => ({
  jevRecognitionJudge: (request: JudgeRequest) => judgeMock(request),
}));

import { gameRoutes } from "./games.js";

const userId = "00000000-0000-4000-8000-0000000000a1";
const friendId = "00000000-0000-4000-8000-0000000000a2";

function authHeaders(asUser = userId): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
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

async function postScore(gameId: string, periodKey: string, scoreRaw: string, asUser = userId) {
  const res = await gameRoutes.request(`/${gameId}/scores`, {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey, scoreRaw }),
  });
  expect(res.status).toBe(200);
}

async function recognize(text: string, asUser = userId) {
  return gameRoutes.request("/recognize", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ text }),
  });
}

type Match = { game: { id: string; title: string }; inMyGames: boolean; method: string } | null;
const matchOf = async (res: Response) => ((await res.json()) as { match: Match }).match;

function setMode(mode: "off" | "shadow" | "on" | undefined) {
  if (mode === undefined) delete process.env.GAME_RECOGNITION;
  else process.env.GAME_RECOGNITION = mode;
  resetConfigForTesting();
}

const MAPTAP = "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770";
const HEADERLESS_MAPTAP = "98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947";
const mini = (date: string, time: string) =>
  `I solved the ${date} New York Times Mini Crossword in ${time}!`;

let maptapId: string;
let miniId: string;
let krillionId: string;

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.TYPESAFE_API_KEY = "test-key";

  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'recognizer@example.com', 'Recognizer'),
       ($2, 'friend@example.com', 'Friend')`,
    [userId, friendId],
  );

  maptapId = await addGame("https://maptap.gg");
  miniId = await addGame("https://www.nytimes.com/crosswords/game/mini");
  // A user-added (non-registry) game: recognition must work for it too.
  krillionId = await addGame("https://krillion.io");
  await rows(`UPDATE games SET title = 'Krillion · the daily dive' WHERE id = $1`, [krillionId]);

  // Other players' scores are the examples.
  await addGame("https://www.nytimes.com/crosswords/game/mini", friendId);
  await postScore(miniId, "2026-05-20", mini("5/20/2026", "0:16"), friendId);
  await postScore(miniId, "2026-05-21", mini("5/21/2026", "1:02"), friendId);
  await postScore(miniId, "2026-05-22", mini("5/22/2026", "0:48"), friendId);
  await postScore(maptapId, "2026-05-27", MAPTAP, friendId);
}, 60_000);

beforeEach(() => {
  judgeMock.mockReset();
  judgeMock.mockResolvedValue(null);
});

afterEach(() => {
  setMode(undefined);
  vi.restoreAllMocks();
});

describe("POST /v1/games/recognize", () => {
  it("is 404 unless GAME_RECOGNITION=on — off by default, and in shadow", async () => {
    expect((await recognize(MAPTAP)).status).toBe(404);
    setMode("shadow");
    expect((await recognize(MAPTAP)).status).toBe(404);
    setMode("on");
    expect((await recognize(MAPTAP)).status).toBe(200);
  });

  it("requires auth and a non-empty, bounded text", async () => {
    setMode("on");
    const anonymous = await gameRoutes.request("/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: MAPTAP }),
    });
    expect(anonymous.status).toBe(401);
    expect((await recognize("")).status).toBe(400);
    expect((await recognize("x".repeat(2001))).status).toBe(400);
  });

  it("recognizes a share by its link and by a user-added game's name", async () => {
    setMode("on");
    expect(await matchOf(await recognize(MAPTAP))).toMatchObject({
      game: { id: maptapId, title: "MapTap" },
      inMyGames: true,
      method: "url",
      confidence: 0.99,
    });
    expect(await matchOf(await recognize("Krillion #77 🦐\n305\n\n🏮🐟🫧🐟🐟🦑🦑"))).toMatchObject({
      game: { id: krillionId },
      method: "label",
    });
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("recognizes a nameless share from other players' stored scores", async () => {
    setMode("on");
    expect(await matchOf(await recognize(mini("6/01/2026", "0:13")))).toMatchObject({
      game: { id: miniId },
      method: "fingerprint",
    });
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("finds a registry game outside My Games, and says so", async () => {
    setMode("on");
    const match = await matchOf(await recognize("Wordle 1,127 3/6\n\n⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩"));
    expect(match).toMatchObject({ game: { title: "Wordle" }, inMyGames: false, method: "label" });
  });

  it("falls back to Jev, and surfaces its pick only above the threshold", async () => {
    setMode("on");
    judgeMock.mockImplementation(async () => ({ probabilities: { [maptapId]: 0.91 } }));
    expect(await matchOf(await recognize(HEADERLESS_MAPTAP))).toMatchObject({
      game: { id: maptapId },
      method: "jev",
      confidence: 0.91,
    });
    const sent = judgeMock.mock.calls[0]?.[0];
    expect(sent?.games.find((g) => g.id === maptapId)?.examples).toEqual([MAPTAP]);

    judgeMock.mockImplementation(async () => ({ probabilities: { [maptapId]: 0.7 } }));
    expect(await matchOf(await recognize(HEADERLESS_MAPTAP))).toBeNull();
  });

  it("answers 'no match' when Jev fails — never an error", async () => {
    setMode("on");
    judgeMock.mockRejectedValue(new Error("jev timeout"));
    const res = await recognize(HEADERLESS_MAPTAP);
    expect(res.status).toBe(200);
    expect(await matchOf(res)).toBeNull();
  });

  it("answers 'no match' for text that is not a score", async () => {
    setMode("on");
    // Nothing result-like (no number, no emoji): not worth a Jev call.
    expect(await matchOf(await recognize("see you later"))).toBeNull();
    expect(await matchOf(await recognize("anyone playing wordle today?"))).toBeNull();
    expect(judgeMock).not.toHaveBeenCalled();
    // Could be a hand-typed score, so Jev is asked — and says none.
    judgeMock.mockImplementation(async () => ({ probabilities: { [maptapId]: 0.01 } }));
    expect(await matchOf(await recognize("see you at 7"))).toBeNull();
    expect(judgeMock).toHaveBeenCalledTimes(1);
  });
});

describe("shadow mode on score posts", () => {
  const shadowLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .filter(([msg]) => msg === "game recognition shadow")
      .map(([, fields]) => fields as Record<string, unknown>);

  it("logs nothing and runs nothing when the flag is off", async () => {
    const info = vi.spyOn(logger, "info");
    await postScore(maptapId, "2026-06-01", HEADERLESS_MAPTAP);
    expect(shadowLines(info)).toEqual([]);
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("logs agreement when the prediction matches the game the user chose", async () => {
    setMode("shadow");
    const info = vi.spyOn(logger, "info");
    await postScore(maptapId, "2026-06-02", MAPTAP);
    expect(shadowLines(info)).toEqual([
      expect.objectContaining({
        kind: "game_recognition_shadow",
        user_id: userId,
        period_key: "2026-06-02",
        actual_game_id: maptapId,
        predicted_game_id: maptapId,
        method: "url",
        outcome: "agree",
        judge_called: false,
      }),
    ]);
  });

  it("logs disagreement when the user posts one game's score under another", async () => {
    setMode("shadow");
    const info = vi.spyOn(logger, "info");
    await postScore(krillionId, "2026-06-03", MAPTAP);
    expect(shadowLines(info)[0]).toMatchObject({
      actual_game_id: krillionId,
      predicted_game_id: maptapId,
      outcome: "disagree",
    });
    // The post itself is untouched: it landed under the game the user chose.
    const [stored] = await rows<{ score_raw: string }>(
      `SELECT score_raw FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = $3`,
      [krillionId, userId, "2026-06-03"],
    );
    expect(stored?.score_raw).toBe(MAPTAP);
  });

  it("does not use the score it is predicting as one of its own examples", async () => {
    setMode("shadow");
    judgeMock.mockImplementation(async () => ({ probabilities: {} }));
    const gridOnly = "🏮🐟🫧🐟🐟🦑🦑 305 points";
    await postScore(krillionId, "2026-06-04", gridOnly);
    const sent = judgeMock.mock.calls[0]?.[0];
    expect(sent?.games.find((g) => g.id === krillionId)?.examples).not.toContain(gridOnly);
  });

  it("still saves the score and answers 200 when recognition blows up", async () => {
    setMode("shadow");
    judgeMock.mockRejectedValue(new Error("jev down"));
    const info = vi.spyOn(logger, "info");
    await postScore(maptapId, "2026-06-05", HEADERLESS_MAPTAP);
    expect(shadowLines(info)[0]).toMatchObject({
      outcome: "none",
      judge_called: true,
      judge_failed: true,
    });
  });
});
