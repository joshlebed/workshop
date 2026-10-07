// Old vs new over every stored score: what the legacy parser / formatter make
// of each `game_scores.score_raw`, against what the game's stored code makes
// of it in the sandbox. This is the evidence for switching GAME_CODE_PARSING
// on, and the way to re-check after changing a game's code.
//
//   pnpm --filter @workshop/backend exec tsx scripts/compare-game-code.ts \
//     [--snapshot=<file.json>] [--save-snapshot=<file.json>] [--out=<results.json>] \
//     [--code=db|seed] [--game=<title substring>] [--examples=3] [--markdown]
//
// Data source, in order: `--snapshot` (a file a previous run saved), else
// `EVAL_DATABASE_URL` (opened READ ONLY — point it at prod or a Neon branch),
// else the local `DATABASE_URL` (the dev seed: a smoke test, not evidence).
// The snapshot holds real users' score text: keep it out of the repo.
//
// `--code=db` runs the code in `games.parse_code` / `format_code` (a migrated
// database). `--code=seed` computes what the seed migration WOULD install —
// builtin code for registry games, compiled specs for taught ones — so the
// comparison can run against a database that has not been migrated yet.
// Default: `db` when the source has the columns, else `seed`.

import { readFileSync, writeFileSync } from "node:fs";
import {
  formatShareBodyFallback,
  gameDefinitionForKey,
  identifyGame,
  matchShareText,
} from "@workshop/shared/gameRegistry";
import { safeParseScoreSpec } from "@workshop/shared/scoreParsing";
import { evaluateSummarySpec, safeParseSummarySpec } from "@workshop/shared/summarySpec";
import postgres from "postgres";
import { parseScoreValue, specForGame } from "../src/lib/gameCatalog.js";
import { builtinGameCodeFor } from "../src/lib/gameCode/builtin.js";
import { shutdownGameCodeSandbox } from "../src/lib/gameCode/runtime.js";
import {
  classifyParseChange,
  type GameCode,
  PARSE_CHANGES,
  type ParseChange,
  parseChangeAgrees,
  scoreWithGameCode,
} from "../src/lib/gameCode/scoring.js";
import { compileScoreSpec, compileSummarySpec } from "../src/lib/gameCode/specCode.js";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k as string, v.join("=") || "1"];
  }),
);
const EXAMPLES = Number(args.get("examples") ?? 0);
const GAME_FILTER = args.get("game")?.toLowerCase();

interface GameRow {
  id: string;
  title: string;
  url: string | null;
  normalizedUrl: string;
  gameKey: string | null;
  scoreSpec: unknown;
  summarySpec: unknown;
  /** Undefined when the source predates the code columns. */
  parseCode?: string | null;
  formatCode?: string | null;
}
interface ScoreRow {
  gameId: string;
  raw: string;
  /** What the database holds today (may predate the current legacy parser). */
  storedValue: number | null;
}
interface Snapshot {
  games: GameRow[];
  scores: ScoreRow[];
}

// biome-ignore lint/suspicious/noExplicitAny: untyped rows from two sources, normalized right here
function normalize(input: any): Snapshot {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: see above
    games: input.games.map((g: any) => ({
      id: g.id,
      title: g.title,
      url: g.url ?? null,
      normalizedUrl: g.normalizedUrl ?? g.normalized_url,
      gameKey: g.gameKey ?? g.game_key ?? null,
      scoreSpec: g.scoreSpec ?? g.score_spec ?? null,
      summarySpec: g.summarySpec ?? g.summary_spec ?? null,
      parseCode: g.parseCode ?? g.parse_code,
      formatCode: g.formatCode ?? g.format_code,
    })),
    // biome-ignore lint/suspicious/noExplicitAny: see above
    scores: input.scores.map((s: any) => {
      const stored = s.storedValue ?? s.score_value ?? null;
      return {
        gameId: s.gameId ?? s.game_id,
        raw: s.raw ?? s.score_raw,
        storedValue: stored === null ? null : Number(stored),
      };
    }),
  };
}

async function loadSnapshot(): Promise<Snapshot> {
  const file = args.get("snapshot");
  if (file) return normalize(JSON.parse(readFileSync(file, "utf8")));
  const url = process.env.EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("pass --snapshot=<file> or set EVAL_DATABASE_URL / DATABASE_URL");
  // Read only at the session level: this script must never write to a real DB.
  const sql = postgres(url, {
    max: 1,
    connection: { default_transaction_read_only: "on" } as Record<string, string>,
  });
  try {
    // `select *` so the same query works before and after the code columns exist.
    const games = await sql`select * from games`;
    const scores = await sql`
      select game_id, score_raw, score_value from game_scores order by created_at`;
    return normalize({ games, scores });
  } finally {
    await sql.end();
  }
}

/** The code the seed migration installs for a game (mirrors seedSql.ts). */
function seedCodeFor(game: GameRow): GameCode {
  const builtin = builtinGameCodeFor(game);
  if (builtin) return { parseCode: builtin.parse, formatCode: builtin.format };
  const scoreSpec = safeParseScoreSpec(game.scoreSpec);
  if (!scoreSpec) return { parseCode: null, formatCode: null };
  const summarySpec = safeParseSummarySpec(game.summarySpec);
  return {
    parseCode: compileScoreSpec(scoreSpec),
    formatCode: summarySpec ? compileSummarySpec(summarySpec) : null,
  };
}

/**
 * Today's display text for a row — the chain in
 * apps/highscore/src/games/lib/scoresSummary.ts (`summarizeGameScoreBody`):
 * registry formatter picked by the raw text, else by the game's title/url →
 * taught summary spec → cleaned raw text.
 */
function legacySummary(game: GameRow, raw: string): string | null {
  if (!raw.trim()) return null;
  const key =
    matchShareText(raw.trim())?.key ?? identifyGame([`${game.title} ${game.url ?? ""}`])?.key;
  const formatted = gameDefinitionForKey(key)?.formatShareBody?.(raw);
  if (formatted && formatted.trim().length > 0) return formatted;
  const summarySpec = safeParseSummarySpec(game.summarySpec);
  const taught = summarySpec ? evaluateSummarySpec(summarySpec, raw) : null;
  if (taught && taught.trim().length > 0) return taught;
  const fallback = formatShareBodyFallback(raw);
  return fallback && fallback.trim().length > 0 ? fallback : null;
}

const PARSE_LABELS: Record<ParseChange, string> = {
  same_score: "same score",
  null_to_no_result: "null → no result",
  null_to_failed: "null → failed",
  null_to_score: "null → score",
  score_to_failed: "score → failed",
  score_to_no_result: "score → no result",
  score_changed: "score changed",
};

function emptyCounts(): Record<ParseChange, number> {
  return {
    same_score: 0,
    null_to_no_result: 0,
    null_to_failed: 0,
    null_to_score: 0,
    score_to_failed: 0,
    score_to_no_result: 0,
    score_changed: 0,
  };
}

interface Example {
  raw: string;
  old: number | string | null;
  new: number | string | null;
  detail?: string;
}
interface GameReport {
  title: string;
  gameKey: string | null;
  codeSource: string;
  rows: number;
  parse: Record<ParseChange, number>;
  parseAgree: number;
  /**
   * The same classification against the value the database holds today. It
   * differs from `parse` only where rows predate the current legacy parser
   * and were never rescored.
   */
  stored: Record<ParseChange, number>;
  /** Rows whose stored value is not what the legacy parser returns today. */
  storedStale: number;
  formatSame: number;
  formatDifferent: number;
  failureReasons: Record<string, number>;
  parseExamples: Partial<Record<ParseChange, Example[]>>;
  formatExamples: Example[];
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(n === of ? 0 : 1)}%`;
}

async function main() {
  const snapshot = await loadSnapshot();
  const save = args.get("save-snapshot");
  if (save) writeFileSync(save, JSON.stringify(snapshot));

  const hasColumns = snapshot.games.some((g) => g.parseCode !== undefined);
  const codeMode = args.get("code") ?? (hasColumns ? "db" : "seed");
  if (codeMode === "db" && !hasColumns) throw new Error("--code=db: source has no code columns");

  const reports: GameReport[] = [];
  for (const game of snapshot.games) {
    if (GAME_FILTER && !game.title.toLowerCase().includes(GAME_FILTER)) continue;
    const scores = snapshot.scores.filter((s) => s.gameId === game.id);
    if (scores.length === 0) continue;
    const code: GameCode =
      codeMode === "db"
        ? { parseCode: game.parseCode ?? null, formatCode: game.formatCode ?? null }
        : seedCodeFor(game);
    const legacySpec = specForGame(game);
    const report: GameReport = {
      title: game.title,
      gameKey: game.gameKey,
      codeSource:
        code.parseCode === null
          ? "none (untaught)"
          : code.parseCode.startsWith("var SPEC = ")
            ? "taught spec"
            : "registry port",
      rows: scores.length,
      parse: emptyCounts(),
      parseAgree: 0,
      stored: emptyCounts(),
      storedStale: 0,
      formatSame: 0,
      formatDifferent: 0,
      failureReasons: {},
      parseExamples: {},
      formatExamples: [],
    };
    for (const score of scores) {
      const oldValue = parseScoreValue(score.raw, legacySpec);
      const oldSummary = legacySummary(game, score.raw);
      const next = await scoreWithGameCode(code, score.raw);

      if (oldValue !== score.storedValue) report.storedStale += 1;
      report.stored[classifyParseChange(score.storedValue, next.parseStatus, next.scoreValue)] += 1;
      const cls = classifyParseChange(oldValue, next.parseStatus, next.scoreValue);
      report.parse[cls] += 1;
      if (parseChangeAgrees(cls)) report.parseAgree += 1;
      if (next.parse.kind === "failed") {
        const reason = next.parse.detail
          ? `${next.parse.reason}: ${next.parse.detail}`
          : next.parse.reason;
        report.failureReasons[reason] = (report.failureReasons[reason] ?? 0) + 1;
      }
      if (cls !== "same_score") {
        const list = report.parseExamples[cls] ?? [];
        if (list.length < EXAMPLES) {
          const example: Example = { raw: score.raw, old: oldValue, new: next.scoreValue };
          if (next.parse.kind === "failed" && next.parse.detail) example.detail = next.parse.detail;
          list.push(example);
        }
        report.parseExamples[cls] = list;
      }

      if (oldSummary === next.scoreSummary) report.formatSame += 1;
      else {
        report.formatDifferent += 1;
        if (report.formatExamples.length < EXAMPLES) {
          report.formatExamples.push({ raw: score.raw, old: oldSummary, new: next.scoreSummary });
        }
      }
    }
    reports.push(report);
  }
  await shutdownGameCodeSandbox();
  reports.sort((a, b) => b.rows - a.rows);

  const total = (pick: (r: GameReport) => number) => reports.reduce((n, r) => n + pick(r), 0);
  const rows = total((r) => r.rows);
  console.log(
    `${reports.length} games, ${rows} scores, code from: ${codeMode === "db" ? "database columns" : "the seed (simulated)"}\n`,
  );

  const differing = PARSE_CHANGES.filter((c) => !parseChangeAgrees(c));
  if (args.has("markdown")) {
    console.log(
      `| Game | Rows | Parse agrees | ${differing.map((c) => PARSE_LABELS[c]).join(" | ")} | null → no result | null → failed | Summary identical |`,
    );
    console.log(
      `| --- | ---: | ---: | ${differing.map(() => "---:").join(" | ")} | ---: | ---: | ---: |`,
    );
    for (const r of reports) {
      console.log(
        `| ${r.title.slice(0, 22).replace(/\|/g, "/")} | ${r.rows} | ${pct(r.parseAgree, r.rows)} | ${differing
          .map((c) => r.parse[c] || "")
          .join(
            " | ",
          )} | ${r.parse.null_to_no_result || ""} | ${r.parse.null_to_failed || ""} | ${pct(r.formatSame, r.rows)} |`,
      );
    }
    console.log(
      `| **Total** | ${rows} | ${pct(
        total((r) => r.parseAgree),
        rows,
      )} | ${differing.map((c) => total((r) => r.parse[c]) || "").join(" | ")} | ${total(
        (r) => r.parse.null_to_no_result,
      )} | ${total((r) => r.parse.null_to_failed)} | ${pct(
        total((r) => r.formatSame),
        rows,
      )} |`,
    );
  } else {
    for (const r of reports) {
      console.log(
        `${r.title.slice(0, 26).padEnd(26)} ${String(r.rows).padStart(4)} rows  code: ${r.codeSource.padEnd(15)} parse agrees ${pct(r.parseAgree, r.rows).padStart(6)}  summary identical ${pct(r.formatSame, r.rows).padStart(6)}`,
      );
      for (const c of PARSE_CHANGES) {
        if (c === "same_score" || r.parse[c] === 0) continue;
        console.log(`    ${PARSE_LABELS[c].padEnd(18)} ${r.parse[c]}`);
        for (const e of r.parseExamples[c] ?? []) {
          console.log(
            `        old=${e.old} new=${e.new}${e.detail ? ` (${e.detail})` : ""}  ${JSON.stringify(e.raw.slice(0, 90))}`,
          );
        }
      }
      if (r.storedStale > 0) {
        const vsStored = PARSE_CHANGES.filter((c) => r.stored[c] > 0)
          .map((c) => `${PARSE_LABELS[c]} ${r.stored[c]}`)
          .join(", ");
        console.log(
          `    ${r.storedStale} stored values are not what the legacy parser returns today; against stored: ${vsStored}`,
        );
      }
      if (r.formatDifferent > 0) {
        console.log(`    summary differs    ${r.formatDifferent}`);
        for (const e of r.formatExamples) {
          console.log(`        raw ${JSON.stringify(e.raw.slice(0, 90))}`);
          console.log(`        old ${JSON.stringify(e.old)}`);
          console.log(`        new ${JSON.stringify(e.new)}`);
        }
      }
    }
    console.log(
      `\nTOTAL ${rows} rows: parse agrees ${pct(
        total((r) => r.parseAgree),
        rows,
      )}, summary identical ${pct(
        total((r) => r.formatSame),
        rows,
      )}`,
    );
    console.log("    vs the legacy parser / vs the values stored today");
    for (const c of PARSE_CHANGES) {
      console.log(
        `    ${PARSE_LABELS[c].padEnd(18)} ${String(total((r) => r.parse[c])).padStart(5)} ${String(total((r) => r.stored[c])).padStart(5)}`,
      );
    }
  }

  const out = args.get("out");
  if (out) writeFileSync(out, JSON.stringify({ codeMode, reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
