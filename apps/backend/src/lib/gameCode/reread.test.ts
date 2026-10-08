// The one-off re-read of history: what it decides for each kind of legacy
// row, what `--apply` writes and — as important — what it must leave alone.
// Real SQL (PGlite + the actual migrations) and the real sandbox.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../sql.js";
import {
  type RereadGame,
  type RereadRow,
  type RereadScore,
  rereadGame,
  rereadLogFields,
  writeRereadBatch,
} from "./reread.js";
import { shutdownGameCodeSandbox } from "./runtime.js";
import * as scoring from "./scoring.js";

let pglite: PGlite;
let db: DbClient;

const players = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-0000000000a${i}`);
const DAY = "2026-10-01";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await pglite.query<T>(query, params)).rows;
}

async function loadGame(where: string, param: string): Promise<RereadGame> {
  const [g] = await rows<{
    id: string;
    title: string;
    game_key: string | null;
    parse_code: string | null;
    format_code: string | null;
    code_version: number;
  }>(
    `SELECT id, title, game_key, parse_code, format_code, code_version FROM games WHERE ${where} = $1`,
    [param],
  );
  if (!g) throw new Error(`no game ${param}`);
  return {
    id: g.id,
    title: g.title,
    gameKey: g.game_key,
    parseCode: g.parse_code,
    formatCode: g.format_code,
    codeVersion: g.code_version,
  };
}

interface Stored {
  user_id: string;
  period_key: string;
  score_raw: string;
  score_value: string | null;
  parse_status: string | null;
  score_summary: string | null;
  score_source: string | null;
  code_version: number | null;
  created_at: Date;
  updated_at: Date;
}

async function stored(gameId: string): Promise<Stored[]> {
  return rows<Stored>(
    `SELECT user_id, period_key, score_raw, score_value, parse_status, score_summary, score_source,
            code_version, created_at, updated_at
       FROM game_scores WHERE game_id = $1 ORDER BY period_key, user_id`,
    [gameId],
  );
}

async function scoresOf(gameId: string): Promise<RereadScore[]> {
  return (await stored(gameId)).map((s) => ({
    userId: s.user_id,
    periodKey: s.period_key,
    scoreRaw: s.score_raw,
    scoreValue: s.score_value === null ? null : Number(s.score_value),
    parseStatus: s.parse_status,
    scoreSource: s.score_source,
    codeVersion: s.code_version,
  }));
}

/** [player, raw, value, status, source] — status/source null = a legacy row. */
type Seed = [number, string, number | null, (string | null)?, (string | null)?];

async function seed(gameId: string, scores: Seed[], periodKey = DAY): Promise<void> {
  await rows("DELETE FROM game_scores WHERE game_id = $1", [gameId]);
  for (const [player, raw, value, status = null, source = null] of scores) {
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, parse_status, score_source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-10-01T08:00:00Z', '2026-10-01T09:30:00Z')`,
      [gameId, players[player], periodKey, raw, value, status, source],
    );
  }
}

const apply = (game: RereadGame) => (batch: RereadRow[]) => writeRereadBatch(db, game, batch);

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  pglite = new PGlite();
  const client = drizzle(pglite);
  await migrate(client, { migrationsFolder: "./drizzle" });
  db = client as unknown as DbClient;
  for (const [i, id] of players.entries()) {
    await rows("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `p${i}@example.com`]);
  }
  await rows(
    `INSERT INTO games (normalized_url, url, title) VALUES ('krillion.io', 'https://krillion.io', 'Krillion')`,
  );
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
  await pglite.close();
});

// One Tradle day with every kind of legacy row, plus two rows that are not
// the re-read's to touch.
const TRADLE_DAY: Seed[] = [
  [0, "#Tradle #1558 2/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟩\nhttps://tradle.net/", 2],
  [1, "#Tradle #1558 X/6\n🟩🟩🟩⬜⬜\nhttps://tradle.net/", null],
  [2, "failed", null],
  // A value written by an older parser that the current code reads differently.
  [3, "#Tradle #1558 4/6\n🟩🟩🟩🟩🟩", 1558],
  // Stored code already read this one.
  [4, "#Tradle #1558 3/6\n🟩🟩🟩🟩🟩", 3, "score", "parsed"],
  // Its poster picked the value: 5, although the text says 6.
  [5, "#Tradle #1558 6/6\n🟩🟩🟩🟩🟩", 5, "score", "picked"],
  [6, "#Tradle #1558 5/6\n🟩🟩🟩🟩🟩", null],
];

describe("dry run", () => {
  it("classifies each legacy row and counts the ones it must not touch", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(tradle.id, TRADLE_DAY);
    const before = await stored(tradle.id);

    const reread = await rereadGame(tradle, await scoresOf(tradle.id));

    expect(reread).toMatchObject({
      legacyRows: 5,
      skippedAlreadyRead: 1,
      skippedPicked: 1,
      skippedUntaught: 0,
      deferred: 0,
      written: 0,
    });
    expect(reread.counts).toEqual({
      same_score: 1,
      null_to_no_result: 1,
      null_to_failed: 1,
      null_to_score: 1,
      score_to_failed: 0,
      score_to_no_result: 0,
      score_changed: 1,
    });
    expect(
      reread.rows.map((r) => [r.userId, r.oldValue, r.newValue, r.newStatus, r.change]),
    ).toEqual([
      [players[0], 2, 2, "score", "same_score"],
      [players[1], null, null, "no_result", "null_to_no_result"],
      [players[2], null, null, "failed", "null_to_failed"],
      [players[3], 1558, 4, "score", "score_changed"],
      [players[6], null, 5, "score", "null_to_score"],
    ]);
    expect(reread.rows[2]?.failureReason).toBe("threw");
    expect(reread.rows[0]?.newSummary).toBe("🟩 3·5 2/6");
    // A dry run writes nothing.
    expect(await stored(tradle.id)).toEqual(before);
  });

  it("reports an untaught game's stored values as lost, or leaves the game alone when asked", async () => {
    const krillion = await loadGame("normalized_url", "krillion.io");
    expect(krillion.parseCode).toBe(null);
    await seed(krillion.id, [
      [0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77],
      [1, ":/", null],
    ]);

    const reread = await rereadGame(krillion, await scoresOf(krillion.id));
    expect(reread.counts).toMatchObject({ score_to_failed: 1, null_to_failed: 1 });
    expect(reread.rows.map((r) => [r.oldValue, r.newValue, r.failureReason])).toEqual([
      [77, null, "no_code"],
      [null, null, "no_code"],
    ]);

    const skipped = await rereadGame(krillion, await scoresOf(krillion.id), { skipUntaught: true });
    expect(skipped).toMatchObject({ legacyRows: 2, skippedUntaught: 2, rows: [] });
  });
});

describe("apply", () => {
  it("writes the reading onto each legacy row and nothing else moves", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(tradle.id, TRADLE_DAY);
    const before = await stored(tradle.id);

    const reread = await rereadGame(tradle, await scoresOf(tradle.id), { onBatch: apply(tradle) });
    expect(reread).toMatchObject({ written: 5, changedSinceRead: 0 });

    const after = await stored(tradle.id);
    const byPlayer = (list: Stored[], i: number) => list.find((s) => s.user_id === players[i]);
    const reading = (s: Stored | undefined) =>
      s && [s.score_value, s.parse_status, s.score_summary, s.score_source, s.code_version];

    expect(reading(byPlayer(after, 0))).toEqual(["2", "score", "🟩 3·5 2/6", "parsed", 1]);
    expect(reading(byPlayer(after, 1))).toEqual([null, "no_result", "🟩 3 X/6", "parsed", 1]);
    expect(reading(byPlayer(after, 2))).toEqual([null, "failed", "failed", "parsed", 1]);
    expect(reading(byPlayer(after, 3))).toEqual(["4", "score", "🟩 5 4/6", "parsed", 1]);
    expect(reading(byPlayer(after, 6))).toEqual(["5", "score", "🟩 5 5/6", "parsed", 1]);
    // The row stored code had read, and the row its poster picked: untouched.
    expect(byPlayer(after, 4)).toEqual(byPlayer(before, 4));
    expect(byPlayer(after, 5)).toEqual(byPlayer(before, 5));
    expect(byPlayer(after, 5)?.score_value).toBe("5");

    // Streaks count days played: same rows, same days, same timestamps.
    const identity = (list: Stored[]) =>
      list.map((s) => [s.user_id, s.period_key, s.score_raw, s.created_at, s.updated_at]);
    expect(identity(after)).toEqual(identity(before));
  });

  it("is idempotent: a second run finds nothing left and changes nothing", async () => {
    const tradle = await loadGame("game_key", "tradle");
    const afterFirst = await stored(tradle.id);

    const again = await rereadGame(tradle, await scoresOf(tradle.id), { onBatch: apply(tradle) });

    expect(again).toMatchObject({
      legacyRows: 0,
      skippedAlreadyRead: 6,
      skippedPicked: 1,
      rows: [],
      written: 0,
    });
    expect(await stored(tradle.id)).toEqual(afterFirst);
  });

  it("leaves a row alone if it changed between being read and being written", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(tradle.id, [
      [0, "#Tradle #1558 2/6\n🟩🟩🟩🟩🟩", 2],
      [1, "#Tradle #1558 3/6\n🟩🟩🟩🟩🟩", 3],
      [2, "#Tradle #1558 4/6\n🟩🟩🟩🟩🟩", 4],
      [3, "#Tradle #1558 5/6\n🟩🟩🟩🟩🟩", 5],
    ]);

    const reread = await rereadGame(tradle, await scoresOf(tradle.id), {
      onBatch: async (batch) => {
        // While the batch was in the sandbox: one player re-posted different
        // text, one posted with stored code on, one picked their own value.
        await rows(
          "UPDATE game_scores SET score_raw = $1, score_value = 6 WHERE game_id = $2 AND user_id = $3",
          ["#Tradle #1558 6/6\n🟩🟩🟩🟩🟩", tradle.id, players[1]],
        );
        await rows(
          "UPDATE game_scores SET parse_status = 'score', score_source = 'parsed', score_summary = 'theirs', code_version = 1 WHERE game_id = $1 AND user_id = $2",
          [tradle.id, players[2]],
        );
        await rows(
          "UPDATE game_scores SET score_value = 1, score_source = 'picked' WHERE game_id = $1 AND user_id = $2",
          [tradle.id, players[3]],
        );
        return writeRereadBatch(db, tradle, batch);
      },
    });

    expect(reread).toMatchObject({ written: 1, changedSinceRead: 3 });
    const after = await stored(tradle.id);
    const summary = (i: number) => {
      const s = after.find((r) => r.user_id === players[i]);
      return s && [s.score_value, s.parse_status, s.score_summary, s.score_source];
    };
    expect(summary(0)).toEqual(["2", "score", "🟩 5 2/6", "parsed"]);
    // Each of the other three is exactly as its owner left it.
    expect(summary(1)).toEqual(["6", null, null, null]);
    expect(summary(2)).toEqual(["4", "score", "theirs", "parsed"]);
    expect(summary(3)).toEqual(["1", null, null, "picked"]);
  });

  it("reads and writes in bounded batches", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(
      tradle.id,
      [0, 1, 2, 3, 4].map((i): Seed => [i, `#Tradle #1558 ${i + 1}/6\n🟩🟩🟩🟩🟩`, i + 1]),
    );
    const sizes: number[] = [];
    const reread = await rereadGame(tradle, await scoresOf(tradle.id), {
      batchSize: 2,
      onBatch: (batch) => {
        sizes.push(batch.length);
        return writeRereadBatch(db, tradle, batch);
      },
    });
    expect(sizes).toEqual([2, 2, 1]);
    expect(reread.written).toBe(5);
    expect((await stored(tradle.id)).every((s) => s.parse_status === "score")).toBe(true);
  });

  it("an untaught game's rows become failed and lose their value, with the cleaned text kept", async () => {
    const krillion = await loadGame("normalized_url", "krillion.io");
    await seed(krillion.id, [[0, "Krillion #77 🦐\n305\n\n🏮🐟🫧\nhttps://krillion.io", 77]]);
    await rereadGame(krillion, await scoresOf(krillion.id), { onBatch: apply(krillion) });
    expect(
      (await stored(krillion.id)).map((s) => [
        s.score_value,
        s.parse_status,
        s.score_summary,
        s.score_source,
        s.code_version,
      ]),
    ).toEqual([[null, "failed", "Krillion #77 🦐\n305\n🏮🐟🫧", "parsed", 0]]);
  });
});

describe("failed rows (includeFailed)", () => {
  // A share an older version of the game's code could not read, one the
  // current version also cannot, and one the current version already read.
  const GEOZEE_PARSE = `function parse(raw) {
    var m = raw.match(/^Geozee #[\\d,]+ \u2014 ([\\d,]+)\\/[\\d,]+/m);
    if (!m) throw new Error("not a Geozee share");
    return Number(m[1].replace(/,/g, ""));
  }`;

  async function geozee(): Promise<RereadGame> {
    await rows(
      `INSERT INTO games (normalized_url, url, title, parse_code, code_version)
       VALUES ('geozee.earth', 'https://geozee.earth', 'Geozee', $1, 2)
       ON CONFLICT (normalized_url) DO UPDATE SET parse_code = $1, code_version = 2`,
      [GEOZEE_PARSE],
    );
    const game = await loadGame("normalized_url", "geozee.earth");
    await seed(game.id, [
      [0, "Geozee #91 \u2014 676/798 \u00b7 top 47% 🌍", null, "failed", "parsed"],
      [1, "🌎 Jul 26, 2026 🌍\n🟥🟨🟥🟥🟥🟩 = 6", null, "failed", "parsed"],
      [2, "Geozee #90 \u2014 894/894 \u00b7 top 1% 🌍", null, "failed", "parsed"],
      [3, "Geozee #89 \u2014 670/794 \u00b7 top 37% 🌍", 670, "score", "parsed"],
    ]);
    // Rows 0 and 1 were read by version 1; row 2 by the current version 2.
    await rows("UPDATE game_scores SET code_version = 1 WHERE game_id = $1", [game.id]);
    await rows(
      "UPDATE game_scores SET code_version = 2 WHERE game_id = $1 AND user_id IN ($2, $3)",
      [game.id, players[2], players[3]],
    );
    return game;
  }

  it("are left alone without the option", async () => {
    const game = await geozee();
    const reread = await rereadGame(game, await scoresOf(game.id));
    expect(reread).toMatchObject({ legacyRows: 0, failedRows: 0, skippedAlreadyRead: 4, rows: [] });
  });

  it("re-reads only those an older code version read, and a second run finds nothing", async () => {
    const game = await geozee();
    const before = await stored(game.id);
    const reread = await rereadGame(game, await scoresOf(game.id), {
      includeFailed: true,
      onBatch: apply(game),
    });
    expect(reread).toMatchObject({ failedRows: 2, skippedAlreadyRead: 2, written: 2 });
    expect(reread.rows.map((r) => [r.userId, r.newValue, r.newStatus, r.change])).toEqual([
      [players[0], 676, "score", "null_to_score"],
      [players[1], null, "failed", "null_to_failed"],
    ]);

    const after = await stored(game.id);
    const reading = (i: number) => {
      const s = after.find((r) => r.user_id === players[i]);
      return s && [s.score_value, s.parse_status, s.code_version];
    };
    expect(reading(0)).toEqual(["676", "score", 2]);
    expect(reading(1)).toEqual([null, "failed", 2]);
    // Read by the current version already, and a row holding a score: untouched.
    expect(after[2]).toEqual(before[2]);
    expect(after[3]).toEqual(before[3]);

    const again = await rereadGame(game, await scoresOf(game.id), {
      includeFailed: true,
      onBatch: apply(game),
    });
    expect(again).toMatchObject({ failedRows: 0, skippedAlreadyRead: 4, written: 0 });
    expect(await stored(game.id)).toEqual(after);
  });

  it("does not write over a failed row that was re-posted while it was being read", async () => {
    const game = await geozee();
    const reread = await rereadGame(game, await scoresOf(game.id), {
      includeFailed: true,
      onBatch: async (batch) => {
        await rows(
          "UPDATE game_scores SET parse_status = 'score', score_value = 700, code_version = 2 WHERE game_id = $1 AND user_id = $2",
          [game.id, players[0]],
        );
        return writeRereadBatch(db, game, batch);
      },
    });
    expect(reread).toMatchObject({ written: 1, changedSinceRead: 1 });
    const row = (await stored(game.id)).find((r) => r.user_id === players[0]);
    expect([row?.score_value, row?.parse_status]).toEqual(["700", "score"]);
  });
});

describe("when the sandbox, not the code, is the problem", () => {
  it("does not decide the row: it stays a legacy row for the next run", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(tradle.id, [
      [0, "#Tradle #1558 2/6\n🟩🟩🟩🟩🟩", 2],
      [1, "#Tradle #1558 3/6\n🟩🟩🟩🟩🟩", 3],
    ]);
    const before = await stored(tradle.id);
    vi.spyOn(scoring, "scoreWithGameCode").mockResolvedValue({
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "x",
      parse: { kind: "failed", reason: "sandbox_unavailable", detail: "worker did not start" },
      format: null,
    });

    const reread = await rereadGame(tradle, await scoresOf(tradle.id), { onBatch: apply(tradle) });

    // Not written as `failed`: that would blame the share for an outage and
    // throw away two good values.
    expect(reread).toMatchObject({ legacyRows: 2, deferred: 2, rows: [], written: 0 });
    expect(await stored(tradle.id)).toEqual(before);

    vi.restoreAllMocks();
    const retry = await rereadGame(tradle, await scoresOf(tradle.id), { onBatch: apply(tradle) });
    expect(retry).toMatchObject({ deferred: 0, written: 2 });
  });

  it("stops a game whose code keeps having to be killed, and leaves the rest undecided", async () => {
    const krillion = await loadGame("normalized_url", "krillion.io");
    const bomb: RereadGame = {
      ...krillion,
      parseCode: `function parse() { return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c"); }`,
      codeVersion: 4,
    };
    await seed(
      krillion.id,
      [0, 1, 2, 3, 4, 5].map((i): Seed => [i, `Krillion #${70 + i} 🦐\n${300 + i}`, 70 + i]),
    );
    const startedAt = Date.now();
    const reread = await rereadGame(bomb, await scoresOf(krillion.id));
    // Three kills, each a verdict on the code (failed); then it stops.
    expect(reread.rows).toHaveLength(3);
    expect(reread.rows.every((r) => r.failureReason === "timeout")).toBe(true);
    expect(reread.deferred).toBe(3);
    expect(Date.now() - startedAt).toBeLessThan(3000);
  }, 15_000);
});

describe("rereadLogFields", () => {
  it("is one event per game with the counts an operator needs", async () => {
    const tradle = await loadGame("game_key", "tradle");
    await seed(tradle.id, TRADLE_DAY);
    const reread = await rereadGame(tradle, await scoresOf(tradle.id), { onBatch: apply(tradle) });
    expect(rereadLogFields(reread, "applied")).toEqual({
      kind: "score_reread",
      mode: "applied",
      game_id: tradle.id,
      game_key: "tradle",
      game_title: "Tradle",
      code_version: 1,
      has_code: true,
      legacy_rows: 5,
      failed_rows: 0,
      unchanged: 1,
      gains_value: 1,
      value_changes: 1,
      loses_value: 0,
      becomes_no_result: 1,
      becomes_failed: 1,
      deferred: 0,
      skipped_already_read: 1,
      skipped_picked: 1,
      skipped_untaught: 0,
      written: 5,
      changed_since_read: 0,
    });
  });
});
