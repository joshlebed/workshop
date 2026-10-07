// Changing a game's code: the validation against stored scores that the
// operator script (and later the teach flow) relies on, and the versioned
// write. Real SQL (PGlite + the actual migrations) and the real sandbox.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../sql.js";
import {
  applyGameCodeChange,
  decideGameCodeChange,
  gameCodeAtVersion,
  planGameCodeChange,
} from "./admin.js";
import { BUILTIN_GAME_CODE } from "./builtin.js";
import * as runtime from "./runtime.js";
import { shutdownGameCodeSandbox } from "./runtime.js";

let pglite: PGlite;
let db: DbClient;

const operatorId = "00000000-0000-4000-8000-0000000000e1";
const players = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-0000000000f${i}`);

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await pglite.query<T>(query, params)).rows;
}

async function gameId(normalizedUrl: string): Promise<string> {
  const [row] = await rows<{ id: string }>("SELECT id FROM games WHERE normalized_url = $1", [
    normalizedUrl,
  ]);
  if (!row) throw new Error(`no game ${normalizedUrl}`);
  return row.id;
}

/** [player index, raw, score_value, parse_status] */
type Seeded = [number, string, number | null, string | null];

async function seedScores(game: string, scores: Seeded[]): Promise<void> {
  await rows("DELETE FROM game_scores WHERE game_id = $1", [game]);
  for (const [player, raw, value, status] of scores) {
    await rows(
      `INSERT INTO game_scores (game_id, user_id, period_key, score_raw, score_value, parse_status)
       VALUES ($1, $2, '2026-10-01', $3, $4, $5)`,
      [game, players[player], raw, value, status],
    );
  }
}

const krillionCode = `function parse(raw) {
  var m = raw.match(/^Krillion #\\d+[^\\n]*\\n\\s*([\\d,]+)\\s*$/m);
  if (!m) throw new Error("no Krillion score line");
  return Number(m[1].replace(/,/g, ""));
}`;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  pglite = new PGlite();
  const client = drizzle(pglite);
  await migrate(client, { migrationsFolder: "./drizzle" });
  // PGlite's drizzle client is the same query surface the helpers use.
  db = client as unknown as DbClient;
  await rows("INSERT INTO users (id, email) VALUES ($1, 'operator@example.com')", [operatorId]);
  for (const [i, id] of players.entries()) {
    await rows("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `player${i}@example.com`]);
  }
  await rows(
    `INSERT INTO games (normalized_url, url, title) VALUES ('krillion.io', 'https://krillion.io', 'Krillion')`,
  );
}, 60_000);

afterAll(async () => {
  await shutdownGameCodeSandbox();
  await pglite.close();
});

describe("planGameCodeChange", () => {
  it("passes code that reproduces every stored score with a known result", async () => {
    const tradle = await gameId("tradle.net");
    await seedScores(tradle, [
      [0, "#Tradle #1558 2/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟩", 2, null],
      [1, "#Tradle #1558 4/6\n🟩🟩🟩⬜⬜", 4, "score"],
      [2, "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜", null, "no_result"],
      // A legacy NULL: a loss or an unread share — nobody recorded which.
      [3, "#Tradle #1557 X/6\n🟩⬜⬜⬜⬜", null, null],
      [4, "failed", null, "failed"],
    ]);
    const plan = await planGameCodeChange(
      db,
      { id: tradle },
      {
        parseCode: BUILTIN_GAME_CODE.tradle?.parse ?? null,
        formatCode: BUILTIN_GAME_CODE.tradle?.format ?? null,
      },
    );
    expect(plan).toMatchObject({
      ok: true,
      unavailable: false,
      storedScores: 5,
      storedWithExpectation: 3,
      storedMismatches: [],
      exampleMismatches: [],
    });
  });

  it("lists every stored score the candidate would read differently", async () => {
    const tradle = await gameId("tradle.net");
    const offByOne = `function parse(raw) {
      var m = raw.match(/Tradle\\s*#?\\d+\\s+(\\d+|X)\\/6/i);
      if (!m) throw new Error("no Tradle result line");
      return m[1] === "X" ? 7 : Number(m[1]) + 1;
    }`;
    const plan = await planGameCodeChange(
      db,
      { id: tradle },
      { parseCode: offByOne, formatCode: null },
    );
    expect(plan.ok).toBe(false);
    expect(plan.storedMismatches.map((m) => [m.userId, m.periodKey, m.expected, m.actual])).toEqual(
      [
        [players[0], "2026-10-01", 2, { kind: "score", value: 3 }],
        [players[1], "2026-10-01", 4, { kind: "score", value: 5 }],
        // A recorded loss must stay a loss.
        [players[2], "2026-10-01", null, { kind: "score", value: 7 }],
      ],
    );
  });

  it("rejects format code that fails on any stored share, even one with no known result", async () => {
    const tradle = await gameId("tradle.net");
    const brittle = `function format(raw) { return raw.split("\\n")[1].trim(); }`;
    const plan = await planGameCodeChange(
      db,
      { id: tradle },
      {
        parseCode: BUILTIN_GAME_CODE.tradle?.parse ?? null,
        formatCode: brittle,
      },
    );
    expect(plan.ok).toBe(false);
    expect(plan.storedMismatches.map((m) => [m.step, m.raw, m.actual.kind])).toEqual([
      ["format", "failed", "failed"],
    ]);
  });

  it("rejects code that does not load, and checks the operator's own examples", async () => {
    const krillion = await gameId("krillion.io");
    await seedScores(krillion, []);
    const broken = await planGameCodeChange(
      db,
      { id: krillion },
      {
        parseCode: "function parse(raw) {",
        formatCode: null,
      },
    );
    expect(broken.ok).toBe(false);
    expect(broken.exampleMismatches[0]?.actual).toMatchObject({ reason: "invalid_code" });

    const plan = await planGameCodeChange(
      db,
      { id: krillion },
      { parseCode: krillionCode, formatCode: null },
      [
        { raw: "Krillion #81 🦐\n415\n\n🦑🫧🏮", expected: 415 },
        { raw: "Krillion #82 🦐\n1,020\n\n🦑", expected: 1020 },
        { raw: "Krillion #83 🦐\n77", expected: 83 },
      ],
    );
    expect(plan.ok).toBe(false);
    expect(plan.exampleMismatches.map((m) => [m.index, m.expected, m.actual])).toEqual([
      [2, 83, { kind: "score", value: 77 }],
    ]);
  });

  it("reports stored values that were wrong all along, so the operator can accept them by count", async () => {
    // Prod's Krillion: the legacy first-number fallback stored the puzzle number.
    const krillion = await gameId("krillion.io");
    await seedScores(krillion, [
      [0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77, null],
      [1, "Krillion #78 🦐\n315\n\n🦑🫧🏮", 78, null],
    ]);
    const plan = await planGameCodeChange(
      db,
      { id: krillion },
      {
        parseCode: krillionCode,
        formatCode: null,
      },
    );
    expect(plan.ok).toBe(false);
    expect(plan.storedMismatches.map((m) => [m.expected, m.actual])).toEqual([
      [77, { kind: "score", value: 305 }],
      [78, { kind: "score", value: 315 }],
    ]);
  });

  it("refuses to remove a game's parse code", async () => {
    const krillion = await gameId("krillion.io");
    await expect(
      planGameCodeChange(db, { id: krillion }, { parseCode: null, formatCode: null }),
    ).rejects.toThrow(/cannot be removed/);
  });
});

describe("decideGameCodeChange", () => {
  const krillion = () => gameId("krillion.io");

  it("writes a clean plan, and a plan whose exact differences the author accepted", async () => {
    const id = await krillion();
    const candidate = { parseCode: krillionCode, formatCode: null };
    await seedScores(id, [
      [0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77, null],
      [1, "Krillion #78 🦐\n315\n\n🦑🫧🏮", 78, null],
    ]);
    const plan = await planGameCodeChange(db, { id }, candidate);
    const reviewed = plan.storedMismatchFingerprint;
    expect(reviewed).toMatch(/^[0-9a-f]{12}$/);
    expect(decideGameCodeChange(plan)).toEqual({ write: false, reason: "changes_stored_scores" });
    expect(decideGameCodeChange(plan, "000000000000")).toEqual({
      write: false,
      reason: "changes_stored_scores",
    });
    expect(decideGameCodeChange(plan, reviewed)).toEqual({ write: true, acceptedChanges: 2 });
    // The same plan made again has the same id: it names the set, not the run.
    const again = await planGameCodeChange(db, { id }, candidate);
    expect(again.storedMismatchFingerprint).toBe(reviewed);

    await seedScores(id, []);
    const clean = await planGameCodeChange(db, { id }, candidate);
    expect(clean.storedMismatchFingerprint).toBe(null);
    expect(decideGameCodeChange(clean)).toEqual({ write: true, acceptedChanges: 0 });
    // An acceptance for differences that are no longer there is stale.
    expect(decideGameCodeChange(clean, reviewed)).toEqual({
      write: false,
      reason: "changes_stored_scores",
    });
  });

  it("an acceptance does not carry over to a different set of the same size", async () => {
    // Between the operator's --dry and their write, one player's row goes
    // and another player posts: still two differing rows, not the two that
    // were reviewed.
    const id = await krillion();
    const candidate = { parseCode: krillionCode, formatCode: null };
    await seedScores(id, [
      [0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77, null],
      [1, "Krillion #78 🦐\n315\n\n🦑🫧🏮", 78, null],
    ]);
    const reviewed = (await planGameCodeChange(db, { id }, candidate)).storedMismatchFingerprint;

    await seedScores(id, [
      [0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77, null],
      [2, "Krillion #79 🦐\n990\n\n🦑", 79, null],
    ]);
    const differentRow = await planGameCodeChange(db, { id }, candidate);
    expect(differentRow.storedMismatches).toHaveLength(2);
    expect(differentRow.storedMismatchFingerprint).not.toBe(reviewed);
    expect(decideGameCodeChange(differentRow, reviewed)).toEqual({
      write: false,
      reason: "changes_stored_scores",
    });

    // Same rows, but one player edited their text: also not what was reviewed.
    await seedScores(id, [
      [0, "Krillion #77 🦐\n306\n\n🏮🐟🫧", 77, null],
      [1, "Krillion #78 🦐\n315\n\n🦑🫧🏮", 78, null],
    ]);
    const editedText = await planGameCodeChange(db, { id }, candidate);
    expect(editedText.storedMismatches).toHaveLength(2);
    expect(editedText.storedMismatchFingerprint).not.toBe(reviewed);
    await seedScores(id, []);
  });

  it("never writes when the sandbox could not run the code — an empty mismatch list proves nothing", async () => {
    const id = await krillion();
    await seedScores(id, [[0, "Krillion #77 🦐\n305\n\n🏮🐟🫧", 77, null]]);
    const validate = vi
      .spyOn(runtime, "validateCode")
      .mockResolvedValue({ ok: false, unavailable: true, checked: 0, mismatches: [] });
    const plan = await planGameCodeChange(
      db,
      { id },
      { parseCode: krillionCode, formatCode: null },
      [{ raw: "Krillion #81 🦐\n415", expected: 415 }],
    );
    // Asked once: the examples are not sent to a sandbox that just went away.
    expect(validate).toHaveBeenCalledTimes(1);
    validate.mockRestore();

    expect(plan).toMatchObject({ unavailable: true, ok: false, storedMismatches: [] });
    expect(decideGameCodeChange(plan)).toEqual({ write: false, reason: "sandbox_unavailable" });
    // Not even with an acceptance the operator made earlier.
    expect(plan.storedMismatchFingerprint).toBe(null);
    expect(decideGameCodeChange(plan, "abcdef012345")).toEqual({
      write: false,
      reason: "sandbox_unavailable",
    });
    await seedScores(id, []);
  });

  it("refuses code that fails the operator's examples whatever was accepted", async () => {
    const id = await krillion();
    const plan = await planGameCodeChange(
      db,
      { id },
      { parseCode: krillionCode, formatCode: null },
      [{ raw: "Krillion #83 🦐\n77", expected: 83 }],
    );
    expect(decideGameCodeChange(plan, plan.storedMismatchFingerprint)).toEqual({
      write: false,
      reason: "fails_examples",
    });
  });
});

describe("applyGameCodeChange", () => {
  it("writes the code as the next version with a revision, and leaves stored scores alone", async () => {
    const krillion = await gameId("krillion.io");
    const before = await rows(
      "SELECT score_value, parse_status FROM game_scores WHERE game_id = $1",
      [krillion],
    );
    const examples = [{ raw: "Krillion #81 🦐\n415", expected: 415 }];
    const first = await applyGameCodeChange(db, {
      gameId: krillion,
      candidate: { parseCode: krillionCode, formatCode: null },
      source: "operator",
      authoredBy: operatorId,
      note: "Teach Krillion: the score is the line under the header.",
      examples,
    });
    expect(first.version).toBe(1);
    const second = await applyGameCodeChange(db, {
      gameId: krillion,
      candidate: {
        parseCode: `${krillionCode}\n// v2`,
        formatCode: "function format(raw) { return null; }",
      },
      source: "operator",
      authoredBy: operatorId,
      note: "Add a formatter.",
      examples: [],
    });
    expect(second.version).toBe(2);

    expect(
      await rows("SELECT parse_code, format_code, code_version FROM games WHERE id = $1", [
        krillion,
      ]),
    ).toEqual([
      {
        parse_code: `${krillionCode}\n// v2`,
        format_code: "function format(raw) { return null; }",
        code_version: 2,
      },
    ]);
    expect(
      await rows(
        `SELECT version, source, authored_by, note, examples, parse_code
           FROM game_code_revisions WHERE game_id = $1 ORDER BY version`,
        [krillion],
      ),
    ).toMatchObject([
      {
        version: 1,
        source: "operator",
        authored_by: operatorId,
        note: "Teach Krillion: the score is the line under the header.",
        examples,
        parse_code: krillionCode,
      },
      { version: 2, source: "operator", examples: [] },
    ]);
    // History is not re-parsed by a code change.
    expect(
      await rows("SELECT score_value, parse_status FROM game_scores WHERE game_id = $1", [
        krillion,
      ]),
    ).toEqual(before);
  });

  it("can read back an older version's code for a revert", async () => {
    const krillion = await gameId("krillion.io");
    expect(await gameCodeAtVersion(db, krillion, 1)).toEqual({
      parseCode: krillionCode,
      formatCode: null,
    });
    expect(await gameCodeAtVersion(db, krillion, 99)).toBe(null);
  });

  it("fails loudly for a game that does not exist", async () => {
    await expect(
      applyGameCodeChange(db, {
        gameId: "00000000-0000-4000-8000-00000000dead",
        candidate: { parseCode: krillionCode, formatCode: null },
        source: "operator",
        authoredBy: null,
        note: "x",
        examples: [],
      }),
    ).rejects.toThrow(/no game/);
  });
});
