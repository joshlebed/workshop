// Route-level tests for game-score recognition: POST /v1/games/recognize and
// the shadow-mode log on score posts. Real SQL against PGlite (the candidate
// and example queries are the point); only the Jev call is stubbed.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import type { JudgeRequest, JudgeVerdict } from "../../lib/gameRecognition.js";
import { SHADOW_BUDGET_MS } from "../../lib/gameRecognitionService.js";
import { logger } from "../../lib/logger.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
vi.mock("./link-preview.js", () => ({
  resolveLinkPreview: () => Promise.reject(new Error("network disabled in tests")),
}));

const judgeMock =
  vi.fn<
    (request: JudgeRequest, options?: { timeoutMs?: number }) => Promise<JudgeVerdict | null>
  >();
vi.mock("../../lib/jev.js", () => ({
  jevRecognitionJudge: (request: JudgeRequest, options?: { timeoutMs?: number }) =>
    judgeMock(request, options),
}));

import { gameRoutes } from "./games.js";

const userId = "00000000-0000-4000-8000-0000000000a1";
const friendId = "00000000-0000-4000-8000-0000000000a2";
// On the Games beta allowlist (lib/gamesBeta.ts): recognition is on for this
// account whatever GAME_RECOGNITION says.
const betaUserId = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";

function authHeaders(asUser = userId, impersonatedBy?: string): Record<string, string> {
  const session = impersonatedBy
    ? signSession(asUser, { impersonatorUserId: impersonatedBy })
    : signSession(asUser);
  return { Authorization: `Bearer ${session}`, "Content-Type": "application/json" };
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

async function recognize(text: string, asUser = userId, impersonatedBy?: string) {
  return gameRoutes.request("/recognize", {
    method: "POST",
    headers: authHeaders(asUser, impersonatedBy),
    body: JSON.stringify({ text }),
  });
}

async function capabilities(asUser = userId, impersonatedBy?: string) {
  const res = await gameRoutes.request("/", { headers: authHeaders(asUser, impersonatedBy) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { capabilities?: { recognition: boolean } }).capabilities;
}

type Match = { game: { id: string; title: string }; inMyGames: boolean; method: string } | null;
const matchOf = async (res: Response) => ((await res.json()) as { match: Match }).match;

function setJevKey(key: string) {
  process.env.TYPESAFE_API_KEY = key;
  resetConfigForTesting();
}

function setMode(mode: "off" | "shadow" | "on" | undefined) {
  // Unset means `on` since the 2026-10-08 rollout, so "the default" in these tests
  // is spelled out as "off" — the kill switch — rather than left unset.
  if (mode === undefined) delete process.env.GAME_RECOGNITION;
  else process.env.GAME_RECOGNITION = mode;
  resetConfigForTesting();
}

const MAPTAP = "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770";
const HEADERLESS_MAPTAP = "98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947";
const mini = (date: string, time: string) =>
  `I solved the ${date} New York Times Mini Crossword in ${time}!`;

const geo = (name: string, site: string, score: number) =>
  `${name} · Oct 2nd\n${score} / 1,000\n🟢🟡🟡🟢🟡\n${site}`;

let maptapId: string;
let miniId: string;
let krillionId: string;
let geoHistoryId: string;

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  // Unset means `on` since the 2026-10-08 rollout; this suite isolates one flag,
  // so pin the others to the kill switch.
  process.env.GAME_TEACH = "off";
  process.env.GAME_CODE_PARSING = "off";
  process.env.GAME_RECOGNITION = "off";
  process.env.TYPESAFE_API_KEY = "test-key";

  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'recognizer@example.com', 'Recognizer'),
       ($2, 'friend@example.com', 'Friend'),
       ($3, 'beta@example.com', 'Beta Tester')`,
    [userId, friendId, betaUserId],
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

  // GeoHistory is user-added; its sister GeoSports is a registry game this
  // user has NOT added. The two shares differ only by name and domain.
  geoHistoryId = await addGame("https://www.geohistory.gg");
  await rows(`UPDATE games SET title = 'GeoHistory' WHERE id = $1`, [geoHistoryId]);
  await addGame("https://www.geohistory.gg", friendId);
  await postScore(
    geoHistoryId,
    "2026-10-01",
    geo("GeoHistory", "www.geohistory.gg", 887),
    friendId,
  );
  // A game only the friend plays, with a page-title-less (hostname) title.
  await addGame("https://shrimpdle.io", friendId);
  await addGame("https://maptap.gg", betaUserId);
}, 60_000);

beforeEach(() => {
  judgeMock.mockReset();
  judgeMock.mockResolvedValue(null);
});

afterEach(() => {
  setJevKey("test-key");
  setMode("off");
  vi.restoreAllMocks();
});

describe("POST /v1/games/recognize", () => {
  it("is 404 when GAME_RECOGNITION is off or shadow", async () => {
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

  it("finds a user-added game outside My Games by its link, but not by its name", async () => {
    setMode("on");
    const byLink = await matchOf(
      await recognize("Shrimpdle #4 🦐 312\nhttps://shrimpdle.io/?ref=1"),
    );
    expect(byLink).toMatchObject({
      game: { title: "shrimpdle.io" },
      inMyGames: false,
      method: "url",
    });
    // Anyone can title a catalog game anything, so a name alone proves nothing.
    expect(await matchOf(await recognize("Shrimpdle #4 🦐 312"))).toBeNull();
  });

  it("keeps sister games apart: a GeoSports share is never offered as GeoHistory", async () => {
    setMode("on");
    // Same layout as the GeoHistory this user plays; names GeoSports, which they don't.
    expect(
      await matchOf(await recognize(geo("GeoSports", "www.geosports.app", 616))),
    ).toMatchObject({
      game: { title: "GeoSports" },
      inMyGames: false,
      method: "url",
    });
    expect(
      await matchOf(await recognize(geo("GeoHistory", "www.geohistory.gg", 703))),
    ).toMatchObject({
      game: { id: geoHistoryId },
      inMyGames: true,
      method: "url",
    });
    expect(judgeMock).not.toHaveBeenCalled();
  });

  it("rejects Jev's pick when the share links a site that game's shares never carry", async () => {
    setMode("on");
    // A third sister game nobody has added: only Jev could claim it for GeoHistory.
    judgeMock.mockImplementation(async () => ({ probabilities: { [geoHistoryId]: 0.92 } }));
    const res = await recognize(geo("GeoScience", "www.geoscience.example", 640));
    expect(await matchOf(res)).toBeNull();
    expect(judgeMock).toHaveBeenCalledTimes(1);
    // With the name and link stripped the paste is genuinely ambiguous: Jev decides.
    expect(await matchOf(await recognize("917 / 1,000\n🟢📜🟡🟡🟢"))).toMatchObject({
      game: { id: geoHistoryId },
      method: "jev",
    });
  });

  it("works without a TypeSafe key: deterministic steps answer, Jev is never called", async () => {
    setJevKey("");
    setMode("on");
    expect(await matchOf(await recognize(MAPTAP))).toMatchObject({ method: "url" });
    expect(await matchOf(await recognize(mini("6/02/2026", "0:41")))).toMatchObject({
      method: "fingerprint",
    });
    const res = await recognize(HEADERLESS_MAPTAP);
    expect(res.status).toBe(200);
    expect(await matchOf(res)).toBeNull();
    expect(judgeMock).not.toHaveBeenCalled();
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

  it("gives Jev only the time left in the shadow budget", async () => {
    setMode("shadow");
    judgeMock.mockImplementation(async () => ({ probabilities: {} }));
    await postScore(krillionId, "2026-06-06", "🐟🦑🫧🏮 288 points");
    const timeoutMs = judgeMock.mock.calls[0]?.[1]?.timeoutMs;
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(SHADOW_BUDGET_MS);
  });

  it("returns the saved score promptly when Jev never answers", async () => {
    setMode("shadow");
    judgeMock.mockImplementation(() => new Promise(() => {}));
    const warn = vi.spyOn(logger, "warn");
    const startedAt = Date.now();
    await postScore(krillionId, "2026-06-07", "🦑🦑🫧🏮 301 points");
    expect(Date.now() - startedAt).toBeLessThan(SHADOW_BUDGET_MS + 400);
    expect(shadowLines(warn)).toEqual([
      expect.objectContaining({ outcome: "capped", actual_game_id: krillionId }),
    ]);
    const stored = await rows(
      `SELECT 1 FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = '2026-06-07'`,
      [krillionId, userId],
    );
    expect(stored).toHaveLength(1);
  });

  it("returns the saved score promptly when the recognition queries hang", async () => {
    setMode("shadow");
    // Only recognition opens a transaction on this path; the post's own writes don't.
    vi.spyOn(testDb, "transaction").mockImplementation(() => new Promise(() => {}));
    const warn = vi.spyOn(logger, "warn");
    const startedAt = Date.now();
    await postScore(maptapId, "2026-06-08", MAPTAP);
    expect(Date.now() - startedAt).toBeLessThan(SHADOW_BUDGET_MS + 400);
    expect(shadowLines(warn)).toEqual([expect.objectContaining({ outcome: "capped" })]);
    expect(judgeMock).not.toHaveBeenCalled();
    const stored = await rows(
      `SELECT 1 FROM game_scores WHERE game_id = $1 AND user_id = $2 AND period_key = '2026-06-08'`,
      [maptapId, userId],
    );
    expect(stored).toHaveLength(1);
  });

  it("logs without calling Jev when no TypeSafe key is configured", async () => {
    setJevKey("");
    setMode("shadow");
    const info = vi.spyOn(logger, "info");
    // Nothing deterministic can place this; with a key it would go to Jev.
    await postScore(krillionId, "2026-06-09", "got it in 7 tries today");
    expect(shadowLines(info)[0]).toMatchObject({ outcome: "none", judge_called: false });
    expect(judgeMock).not.toHaveBeenCalled();
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

describe("Games beta accounts", () => {
  const shadowLines = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .filter(([msg]) => msg === "game recognition shadow")
      .map(([, fields]) => fields as Record<string, unknown>);

  it("get recognition with the global flag off; everyone else gets flag-off behaviour", async () => {
    // GAME_RECOGNITION is unset here, i.e. off — what prod runs.
    const res = await recognize(MAPTAP, betaUserId);
    expect(res.status).toBe(200);
    expect(await matchOf(res)).toMatchObject({ game: { id: maptapId }, method: "url" });
    expect((await recognize(MAPTAP, userId)).status).toBe(404);
    expect((await recognize(MAPTAP, friendId)).status).toBe(404);
  });

  it("are told so on GET /v1/games, and everyone else is told it is off", async () => {
    expect(await capabilities(betaUserId)).toMatchObject({ recognition: true });
    expect(await capabilities(userId)).toMatchObject({ recognition: false });
    setMode("shadow");
    expect(await capabilities(userId)).toMatchObject({ recognition: false });
    setMode("on");
    expect(await capabilities(userId)).toMatchObject({ recognition: true });
  });

  it("have their score posts shadow-logged with the global flag off", async () => {
    const info = vi.spyOn(logger, "info");
    await postScore(maptapId, "2026-07-01", MAPTAP, betaUserId);
    expect(shadowLines(info)).toEqual([
      expect.objectContaining({ user_id: betaUserId, outcome: "agree", method: "url" }),
    ]);
  });

  it("leave everyone else's score post untouched: no log line, no recognition query", async () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    // Every recognition DB step opens a transaction; the post itself opens none.
    const transaction = vi.spyOn(testDb, "transaction");
    await postScore(maptapId, "2026-07-02", HEADERLESS_MAPTAP, userId);
    expect(transaction).not.toHaveBeenCalled();
    expect(judgeMock).not.toHaveBeenCalled();
    expect([...shadowLines(info), ...shadowLines(warn)]).toEqual([]);

    await postScore(maptapId, "2026-07-02", MAPTAP, betaUserId);
    expect(transaction).toHaveBeenCalled();
  });

  it("follow the account the session acts as during an impersonation", async () => {
    // A beta admin impersonating a non-beta user sees what that user sees: off.
    expect((await recognize(MAPTAP, userId, betaUserId)).status).toBe(404);
    expect(await capabilities(userId, betaUserId)).toMatchObject({ recognition: false });
    // Impersonating a beta user: on, whoever the impersonator is.
    expect((await recognize(MAPTAP, betaUserId, friendId)).status).toBe(200);
    expect(await capabilities(betaUserId, friendId)).toMatchObject({ recognition: true });
  });
});
