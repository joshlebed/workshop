// The seed migration (drizzle/0043_seed_game_code.sql), run for real against
// PGlite: registry games get their builtin code, games taught through the
// old flow get their spec converted, untaught games get nothing, and running
// it twice changes nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { CATALOG_GAME_DEFINITIONS } from "@workshop/shared/gameRegistry";
import { evaluateScoreSpec, type ScoreSpec } from "@workshop/shared/scoreParsing";
import { evaluateSummarySpec, type SummarySpec } from "@workshop/shared/summarySpec";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrCreateGame } from "../gameCatalog.js";
import type { DbClient } from "../sql.js";
import { BUILTIN_GAME_CODE } from "./builtin.js";
import { runFormat, runParse, shutdownGameCodeSandbox } from "./runtime.js";
import { buildGameCodeSeedSql } from "./seedSql.js";
import {
  compileScoreSpec,
  compileSummarySpec,
  SCORE_SPEC_INTERPRETER,
  SPEC_CODE_PREFIX,
  SUMMARY_SPEC_INTERPRETER,
} from "./specCode.js";

const DRIZZLE_DIR = fileURLToPath(new URL("../../../drizzle/", import.meta.url));
const SEED_TAG = "0043_seed_game_code";
const BREAKPOINT = "--> statement-breakpoint";

interface JournalEntry {
  idx: number;
  tag: string;
}

function migrationSql(tag: string): string {
  return readFileSync(`${DRIZZLE_DIR}${tag}.sql`, "utf8");
}

async function applyMigration(db: PGlite, tag: string): Promise<void> {
  for (const statement of migrationSql(tag).split(BREAKPOINT)) {
    if (statement.trim()) await db.exec(statement);
  }
}

interface GameCodeRow {
  id: string;
  title: string;
  game_key: string | null;
  parse_code: string | null;
  format_code: string | null;
  code_version: number;
}

const geoHistorySpec: ScoreSpec = {
  rules: [{ kind: "capture", pattern: "([\\d,]+)\\s*\\/\\s*1,000\\b" }],
};
const geoHistorySummary: SummarySpec = { rules: [{ kind: "matchLines", pattern: "^[^A-Za-z]+$" }] };
const geozeeSpec: ScoreSpec = {
  rules: [{ kind: "capture", pattern: "([\\d,]+)\\s*\\/\\s*775\\b" }],
};

let db: PGlite;

async function gameByUrl(normalizedUrl: string): Promise<GameCodeRow> {
  const res = await db.query<GameCodeRow>(
    `SELECT id, title, game_key, parse_code, format_code, code_version
       FROM games WHERE normalized_url = $1`,
    [normalizedUrl],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`no game at ${normalizedUrl}`);
  return row;
}

async function revisionsFor(gameId: string) {
  const res = await db.query<{ version: number; source: string; parse_code: string | null }>(
    "SELECT version, source, parse_code FROM game_code_revisions WHERE game_id = $1 ORDER BY version",
    [gameId],
  );
  return res.rows;
}

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);

  // Every migration before the seed, then the rows prod has that a fresh
  // database does not: games players added and taught themselves.
  const journal = JSON.parse(readFileSync(`${DRIZZLE_DIR}meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  const seedIdx = journal.entries.find((e) => e.tag === SEED_TAG)?.idx;
  if (seedIdx === undefined) throw new Error(`${SEED_TAG} is not in the journal`);
  db = new PGlite();
  for (const entry of journal.entries) {
    if (entry.idx < seedIdx) await applyMigration(db, entry.tag);
  }
  await db.query(
    `INSERT INTO games (normalized_url, url, title, game_key, score_direction, score_spec, summary_spec) VALUES
       ('geohistory.gg', 'https://geohistory.gg', 'GeoHistory', NULL, 'desc', $1, $2),
       ('geozee.earth', 'https://geozee.earth', 'Geozee', NULL, 'desc', $3, NULL),
       ('krillion.io', 'https://krillion.io', 'Krillion', NULL, 'desc', NULL, NULL),
       ('hbd.gg/play', 'https://hbd.gg/play', 'EthnoGuessr', NULL, 'desc', $4, NULL)`,
    [
      JSON.stringify(geoHistorySpec),
      JSON.stringify(geoHistorySummary),
      JSON.stringify(geozeeSpec),
      JSON.stringify({ rules: [{ kind: "capture", pattern: "of\\s*([\\d,]+(?:\\.\\d+)?)" }] }),
    ],
  );
  // Anthropeum in prod: a registry game that still carries the spec a player
  // taught before the registry knew it.
  await db.query("UPDATE games SET score_spec = $1 WHERE game_key = 'anthropeum'", [
    JSON.stringify({ rules: [{ kind: "capture", pattern: "([\\d,]+(?:\\.\\d+)?)\\s*·" }] }),
  ]);

  await applyMigration(db, SEED_TAG);
}, 60_000);

afterAll(async () => {
  await shutdownGameCodeSandbox();
  await db.close();
});

describe("seed migration file", () => {
  it("is exactly what the generator produces from builtin.ts and specCode.ts", () => {
    // If this fails after an intentional edit and the migration has NOT
    // shipped: `pnpm exec tsx scripts/generate-game-code-seed.ts`. If it has
    // shipped, revert the edit and write a new migration instead.
    expect(migrationSql(SEED_TAG)).toBe(buildGameCodeSeedSql());
  });
});

describe("registry games", () => {
  it("every catalog game gets its builtin code as version 1, with a seed revision", async () => {
    const res = await db.query<GameCodeRow>(
      "SELECT id, title, game_key, parse_code, format_code, code_version FROM games WHERE game_key IS NOT NULL",
    );
    expect(res.rows.map((r) => r.game_key).sort()).toEqual(
      CATALOG_GAME_DEFINITIONS.map((d) => d.key).sort(),
    );
    for (const row of res.rows) {
      const builtin = BUILTIN_GAME_CODE[row.game_key as keyof typeof BUILTIN_GAME_CODE];
      expect(builtin, row.title).toBeDefined();
      expect(row.parse_code, row.title).toBe(builtin?.parse);
      expect(row.format_code, row.title).toBe(builtin?.format);
      expect(row.code_version, row.title).toBe(1);
      expect(await revisionsFor(row.id), row.title).toEqual([
        { version: 1, source: "seed", parse_code: builtin?.parse },
      ]);
    }
  });

  it("prefers builtin code over a stale taught spec on a registry row", async () => {
    const anthropeum = await gameByUrl("anthropeum.com");
    expect(anthropeum.parse_code).toBe(BUILTIN_GAME_CODE.anthropeum?.parse);
  });

  it("finds a detection-only registry game a player already added, by its URL", async () => {
    const ethno = await gameByUrl("hbd.gg/play");
    expect(ethno.parse_code).toBe(BUILTIN_GAME_CODE.ethnoguessr?.parse);
    expect(ethno.format_code).toBe(BUILTIN_GAME_CODE.ethnoguessr?.format);
    expect((await revisionsFor(ethno.id)).map((r) => r.source)).toEqual(["seed"]);
  });
});

describe("taught games", () => {
  it("converts score_spec and summary_spec to the code compileScoreSpec would write", async () => {
    const game = await gameByUrl("geohistory.gg");
    expect(game.code_version).toBe(1);
    expect((await revisionsFor(game.id)).map((r) => r.source)).toEqual(["spec"]);

    // Same shape as the TypeScript compiler's output: the spec as data, then
    // the fixed interpreter. (Postgres prints jsonb with its own spacing, so
    // the data line is compared as JSON, not as text.)
    for (const [stored, spec, interpreter] of [
      [game.parse_code, geoHistorySpec, SCORE_SPEC_INTERPRETER],
      [game.format_code, geoHistorySummary, SUMMARY_SPEC_INTERPRETER],
    ] as const) {
      expect(stored?.startsWith(SPEC_CODE_PREFIX)).toBe(true);
      expect(stored?.endsWith(`;\n${interpreter}`)).toBe(true);
      const data = stored?.slice(SPEC_CODE_PREFIX.length, -`;\n${interpreter}`.length) ?? "";
      expect(JSON.parse(data)).toEqual(spec);
    }
  });

  it("the converted code runs and agrees with the spec it came from", async () => {
    const game = await gameByUrl("geohistory.gg");
    const shares = [
      "GeoHistory · Aug 3rd\n842 / 1,000\n🟢🟢🟡🟢🔴\nwww.geohistory.gg",
      "GeoHistory · Aug 4th\n🟢🟢🟢🟢🟢\n1,000 / 1,000\nwww.geohistory.gg",
      "something else entirely 12",
    ];
    for (const raw of shares) {
      const expected = evaluateScoreSpec(geoHistorySpec, raw).value;
      const fromSql = await runParse(game.parse_code ?? "", raw);
      expect(fromSql).toEqual(await runParse(compileScoreSpec(geoHistorySpec), raw));
      if (expected === null) expect(fromSql.kind).toBe("failed");
      else expect(fromSql).toEqual({ kind: "score", value: expected });

      const summary = evaluateSummarySpec(geoHistorySummary, raw);
      const formatted = await runFormat(game.format_code ?? "", raw);
      expect(formatted).toEqual(await runFormat(compileSummarySpec(geoHistorySummary), raw));
      expect(formatted).toEqual(summary ? { kind: "summary", text: summary } : { kind: "none" });
    }
  });

  it("leaves format_code NULL when no summary spec was taught", async () => {
    const game = await gameByUrl("geozee.earth");
    expect(game.parse_code?.startsWith(SPEC_CODE_PREFIX)).toBe(true);
    expect(game.format_code).toBe(null);
  });

  it("gives an untaught game no code, version 0 and no revision", async () => {
    const game = await gameByUrl("krillion.io");
    expect(game).toMatchObject({ parse_code: null, format_code: null, code_version: 0 });
    expect(await revisionsFor(game.id)).toEqual([]);
  });
});

describe("idempotence", () => {
  it("running the seed again changes nothing and never overwrites later edits", async () => {
    const edited = "function parse(raw) { return 1; }";
    await db.query("UPDATE games SET parse_code = $1, code_version = 2 WHERE game_key = 'wordle'", [
      edited,
    ]);
    const before = await db.query("SELECT count(*)::int AS n FROM game_code_revisions");

    await applyMigration(db, SEED_TAG);

    const after = await db.query("SELECT count(*)::int AS n FROM game_code_revisions");
    expect(after.rows).toEqual(before.rows);
    const wordle = await gameByUrl("nytimes.com/games/wordle");
    expect(wordle).toMatchObject({ parse_code: edited, code_version: 2 });
    const tradle = await gameByUrl("tradle.net");
    expect(tradle.parse_code).toBe(BUILTIN_GAME_CODE.tradle?.parse);
  });
});

// Migration 0043 only reaches rows that existed when it ran. A registry game
// whose row is created later — nobody had added it yet, or a fresh database
// lost the row — must come into being with the same code and revision.
describe("registry games created after the seed", () => {
  const client = () => drizzle(db) as unknown as DbClient;

  it("a catalog game's new row is created with its builtin code and a seed revision", async () => {
    await db.query("DELETE FROM games WHERE game_key = 'strands'");
    const game = await findOrCreateGame(
      "https://www.nytimes.com/games/strands",
      undefined,
      client(),
    );
    expect(game).toMatchObject({
      gameKey: "strands",
      parseCode: BUILTIN_GAME_CODE.strands?.parse,
      formatCode: null,
      codeVersion: 1,
    });
    expect(await revisionsFor(game.id)).toEqual([
      { version: 1, source: "seed", parse_code: BUILTIN_GAME_CODE.strands?.parse },
    ]);
    // The code it was created with actually runs.
    expect(await runParse(game.parseCode ?? "", "Strands #100\n🔵💡🔵🟡")).toEqual({
      kind: "score",
      value: 1,
    });
  });

  it("finding the row again changes nothing", async () => {
    const first = await findOrCreateGame(
      "https://www.nytimes.com/games/strands",
      undefined,
      client(),
    );
    const again = await findOrCreateGame("https://nytimes.com/games/strands/", undefined, client());
    expect(again.id).toBe(first.id);
    expect(await revisionsFor(first.id)).toHaveLength(1);
  });

  it("a detection-only registry game added by URL gets its builtin code too", async () => {
    await db.query("DELETE FROM games WHERE normalized_url = 'hbd.gg/play'");
    const game = await findOrCreateGame("https://hbd.gg/play", undefined, client());
    expect(game).toMatchObject({
      gameKey: null,
      parseCode: BUILTIN_GAME_CODE.ethnoguessr?.parse,
      formatCode: BUILTIN_GAME_CODE.ethnoguessr?.format,
      codeVersion: 1,
    });
    expect((await revisionsFor(game.id)).map((r) => r.source)).toEqual(["seed"]);
  });

  it("an unknown game is created with no code, version 0 and no revision", async () => {
    const game = await findOrCreateGame("https://brand-new-game.example", undefined, client());
    expect(game).toMatchObject({ parseCode: null, formatCode: null, codeVersion: 0 });
    expect(await revisionsFor(game.id)).toEqual([]);
  });
});
