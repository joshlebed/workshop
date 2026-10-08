/**
 * The one-off re-read of history (docs/highscore-score-validation-spec.md,
 * section 8) — the successor to rescore-game.ts for the stored-code world.
 *
 * Every score the legacy parser wrote (a `game_scores` row with no
 * `parse_status`) is run through its game's stored code. DRY RUN BY DEFAULT:
 * it prints what would change and writes nothing.
 *
 *   # dry run against a read-only connection (prod, or a Neon branch)
 *   EVAL_DATABASE_URL=<url> pnpm --filter @workshop/backend run admin:reread-scores
 *
 *   # dry run from / to an export (real users' score text — keep it out of the repo)
 *   … admin:reread-scores --save-snapshot=/tmp/scores.json
 *   … admin:reread-scores --snapshot=/tmp/scores.json --markdown
 *
 *   # write, to the database in DATABASE_URL
 *   DATABASE_URL=<url> pnpm --filter @workshop/backend run admin:reread-scores --apply
 *
 * What `--apply` writes on each legacy row: `score_value`, `parse_status`,
 * `score_summary`, `score_source = 'parsed'` and `code_version`. Nothing else:
 * no row is added or removed and no date moves, so streaks (days played) and
 * "posted 2h ago" do not change. It never touches a row stored code already
 * read, or one whose value its poster picked. It is idempotent — a second run
 * finds nothing left to do — and safe to interrupt: each batch is its own
 * transaction, and a row re-posted while it runs is left as its owner made it.
 *
 * Flags:
 *   --apply                 write the changes (needs DATABASE_URL; refuses a snapshot
 *                           or EVAL_DATABASE_URL, which are read-only by design)
 *   --yes                   skip the 5 s countdown before --apply writes
 *   --game=<id|key|url>     only this game (repeat or comma-separate for several)
 *   --include-failed        also re-read `failed` rows that an older version of the
 *                           game's code read (a row the current version read is
 *                           skipped: same code, same text, same answer). Rows that
 *                           hold a score or a no-result are never re-read
 *   --skip-untaught         leave games with no parse code alone. Without this their
 *                           legacy rows become `failed` and LOSE any stored value:
 *                           "a game with no parser is unread until taught" (spec §1)
 *   --batch=<n>             rows read and written per transaction (default 100)
 *   --snapshot=<file>       read games + scores from an export instead of a database
 *   --save-snapshot=<file>  write the export this run read
 *   --out=<file.json>       write the full report (every row) as JSON
 *   --markdown              print the report as Markdown
 *   --public                for output that will be posted somewhere public: omit
 *                           user ids and print only the first line of each share
 *
 * The report goes to stdout. One structured `score_reread` event per game, and
 * a `score_reread_summary`, go to stderr. No other backend env is needed.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { getDb } from "../src/db/client.js";
import { gameScores, games } from "../src/db/schema.js";
import {
  type GameReread,
  type RereadGame,
  type RereadRow,
  type RereadScore,
  rereadGame,
  rereadLogFields,
  writeRereadBatch,
} from "../src/lib/gameCode/reread.js";
import { shutdownGameCodeSandbox } from "../src/lib/gameCode/runtime.js";

function args(name: string): string[] {
  return process.argv
    .filter((a) => a.startsWith(`${name}=`))
    .flatMap((a) => a.slice(name.length + 1).split(","))
    .filter(Boolean);
}
const arg = (name: string): string | null => args(name)[0] ?? null;
const flag = (name: string) => process.argv.includes(name);

// One structured line per event, on stderr so stdout stays the report. Not the
// backend `logger`: that loads the whole server config, which a dry run from
// an export has no reason to need.
function logEvent(msg: string, fields: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "info", msg, ts: new Date().toISOString(), ...fields }));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

type SnapshotGame = RereadGame & { normalizedUrl: string };

interface Snapshot {
  takenAt: string;
  games: SnapshotGame[];
  /** Scores by game id. */
  scores: Record<string, RereadScore[]>;
}

// biome-ignore lint/suspicious/noExplicitAny: untyped rows from a file or a raw query, normalized right here
function normalize(input: any): Snapshot {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const gameRows: SnapshotGame[] = input.games.map((g: any) => ({
    id: g.id,
    title: g.title,
    gameKey: g.gameKey ?? g.game_key ?? null,
    normalizedUrl: g.normalizedUrl ?? g.normalized_url,
    parseCode: g.parseCode ?? g.parse_code ?? null,
    formatCode: g.formatCode ?? g.format_code ?? null,
    codeVersion: Number(g.codeVersion ?? g.code_version ?? 0),
  }));
  if (!Array.isArray(input.scores)) {
    return { takenAt: input.takenAt, games: gameRows, scores: input.scores };
  }
  const scores: Record<string, RereadScore[]> = {};
  for (const s of input.scores) {
    const gameId: string = s.gameId ?? s.game_id;
    const value = s.scoreValue ?? s.score_value ?? null;
    const list = scores[gameId] ?? [];
    list.push({
      userId: s.userId ?? s.user_id,
      periodKey: s.periodKey ?? s.period_key,
      scoreRaw: s.scoreRaw ?? s.score_raw,
      scoreValue: value === null ? null : Number(value),
      parseStatus: s.parseStatus ?? s.parse_status ?? null,
      scoreSource: s.scoreSource ?? s.score_source ?? null,
      codeVersion: s.codeVersion ?? s.code_version ?? null,
    });
    scores[gameId] = list;
  }
  return { takenAt: input.takenAt ?? new Date().toISOString(), games: gameRows, scores };
}

async function loadReadOnly(url: string): Promise<Snapshot> {
  // Read only at the session level: a dry run must never write to a real DB.
  const sql = postgres(url, {
    max: 1,
    connection: { default_transaction_read_only: "on" } as Record<string, string>,
  });
  try {
    const gameRows = await sql`select * from games`;
    const scoreRows = await sql`select * from game_scores order by game_id, period_key, user_id`;
    return normalize({ takenAt: new Date().toISOString(), games: gameRows, scores: scoreRows });
  } finally {
    await sql.end();
  }
}

async function loadFromDb(): Promise<Snapshot> {
  const db = getDb();
  const gameRows = await db.select().from(games);
  const scoreRows = await db
    .select()
    .from(gameScores)
    .orderBy(gameScores.gameId, gameScores.periodKey, gameScores.userId);
  return normalize({ takenAt: new Date().toISOString(), games: gameRows, scores: scoreRows });
}

function matchesGame(game: SnapshotGame, refs: string[]): boolean {
  return (
    refs.length === 0 ||
    refs.some((ref) => ref === game.id || ref === game.gameKey || ref === game.normalizedUrl)
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const PUBLIC = flag("--public");

function codeLabel(game: RereadGame): string {
  if (game.parseCode === null) return "none (untaught)";
  if (game.parseCode.startsWith("var SPEC = ")) return "taught spec";
  // Written by an operator or by teach, unless the game is in the registry.
  return game.gameKey === null ? "written code" : "registry";
}

function show(value: number | null, status?: string): string {
  if (value !== null) return String(value);
  return status === undefined ? "∅" : status === "no_result" ? "no result" : "failed";
}

/** A stable short stand-in for a user id, so rows can be told apart in public output. */
function userLabel(userId: string): string {
  if (!PUBLIC) return userId;
  return `player ${createHash("sha256").update(userId).digest("hex").slice(0, 4)}`;
}

function rawLabel(raw: string): string {
  const text = PUBLIC ? (raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "") : raw;
  return JSON.stringify(text.length > 140 ? `${text.slice(0, 140)}…` : text);
}

const losesValue = (r: RereadRow) =>
  r.change === "score_to_failed" || r.change === "score_to_no_result";

function rowLine(row: RereadRow): string {
  const why = row.failureReason ? ` (${row.failureReason})` : "";
  return `${row.periodKey}  ${userLabel(row.userId)}  ${show(row.oldValue)} → ${show(row.newValue, row.newStatus)}${why}  ${rawLabel(row.scoreRaw)}`;
}

function printReport(reports: GameReread[], markdown: boolean): void {
  const cell = (n: number) => (n === 0 ? "" : String(n));
  const total = (pick: (r: GameReread) => number) => reports.reduce((n, r) => n + pick(r), 0);
  const columns: Array<[string, (r: GameReread) => number]> = [
    ["Legacy rows", (r) => r.legacyRows],
    ...(flag("--include-failed")
      ? [["Failed rows", (r: GameReread) => r.failedRows] as [string, (r: GameReread) => number]]
      : []),
    ["Unchanged", (r) => r.counts.same_score],
    ["Gains a value", (r) => r.counts.null_to_score],
    ["Value changes", (r) => r.counts.score_changed],
    ["Loses a value", (r) => r.counts.score_to_failed + r.counts.score_to_no_result],
    ["Becomes no result", (r) => r.counts.null_to_no_result],
    [
      flag("--include-failed") ? "Becomes or stays failed" : "Becomes failed",
      (r) => r.counts.null_to_failed,
    ],
    ["Not decided", (r) => r.deferred + r.skippedUntaught],
  ];

  if (markdown) {
    console.log(`| Game | Code | ${columns.map(([name]) => name).join(" | ")} |`);
    console.log(`| --- | --- | ${columns.map(() => "---:").join(" | ")} |`);
    for (const r of reports) {
      console.log(
        `| ${r.game.title.slice(0, 24).replace(/\|/g, "/")} | ${codeLabel(r.game)} | ${columns
          .map(([, pick]) => cell(pick(r)))
          .join(" | ")} |`,
      );
    }
    console.log(
      `| **Total** | | ${columns.map(([, pick]) => `**${total(pick)}**`).join(" | ")} |\n`,
    );
  } else {
    for (const r of reports) {
      console.log(
        `${r.game.title.slice(0, 26).padEnd(26)} ${codeLabel(r.game).padEnd(16)} ${columns
          .map(([name, pick]) => `${name.toLowerCase()} ${pick(r)}`)
          .join(", ")}`,
      );
    }
    console.log(
      `\nTOTAL ${columns.map(([name, pick]) => `${name.toLowerCase()} ${total(pick)}`).join(", ")}\n`,
    );
  }

  const section = (title: string, pick: (row: RereadRow) => boolean, collapse = false) => {
    const games = reports
      .map((r) => ({ r, rows: r.rows.filter(pick) }))
      .filter(({ rows }) => rows.length > 0);
    const count = games.reduce((n, g) => n + g.rows.length, 0);
    if (markdown && collapse) console.log(`<details><summary>${title}: ${count}</summary>\n`);
    else console.log(markdown ? `### ${title}: ${count}\n` : `=== ${title}: ${count}`);
    for (const { r, rows } of games) {
      console.log(
        markdown ? `**${r.game.title}** (${rows.length})\n\n\`\`\`` : `  ${r.game.title}`,
      );
      for (const row of rows) console.log(markdown ? rowLine(row) : `    ${rowLine(row)}`);
      if (markdown) console.log("```\n");
    }
    if (markdown && collapse) console.log("</details>\n");
    else if (!markdown) console.log("");
  };

  section("Rows whose value would change", (row) => row.change === "score_changed");
  section("Rows that would lose a value", losesValue);
  section("Rows that would gain a value", (row) => row.change === "null_to_score", true);
}

// ---------------------------------------------------------------------------

async function main() {
  const apply = flag("--apply");
  const snapshotFile = arg("--snapshot");
  const evalUrl = process.env.EVAL_DATABASE_URL;
  if (apply && (snapshotFile || evalUrl)) {
    fail("--apply writes to DATABASE_URL only: unset EVAL_DATABASE_URL and drop --snapshot");
  }
  if (!snapshotFile && !evalUrl && !process.env.DATABASE_URL) {
    fail("nothing to read: set DATABASE_URL or EVAL_DATABASE_URL, or pass --snapshot=<file>");
  }
  // The sandbox logs through the backend logger, which loads the whole server
  // config. This script signs nothing, and a read-only run never opens
  // DATABASE_URL — so fill in what goes unused rather than ask the operator
  // for it, and keep the backend's own info lines out of the report.
  process.env.SESSION_SECRET ??= "unused-by-reread-scores".padEnd(32, "-");
  if (snapshotFile || evalUrl) process.env.DATABASE_URL ??= "postgres://unused.invalid/unused";
  process.env.LOG_LEVEL ??= "warn";

  const snapshot = snapshotFile
    ? normalize(JSON.parse(readFileSync(snapshotFile, "utf8")))
    : evalUrl
      ? await loadReadOnly(evalUrl)
      : await loadFromDb();
  const save = arg("--save-snapshot");
  if (save) writeFileSync(save, JSON.stringify(snapshot));

  const refs = args("--game");
  const targets = snapshot.games.filter((g) => matchesGame(g, refs));
  if (targets.length === 0) fail(`no game matches --game=${refs.join(",")}`);

  const source = snapshotFile
    ? `export ${snapshotFile} (taken ${snapshot.takenAt})`
    : evalUrl
      ? "EVAL_DATABASE_URL (read-only)"
      : "DATABASE_URL";
  console.log(`${apply ? "APPLYING" : "dry run"} — source: ${source}\n`);
  if (apply && !flag("--yes")) {
    console.log("writing in 5s — Ctrl-C to abort");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const mode = apply ? "applied" : "dry_run";
  const batchSize = Number(arg("--batch") ?? 100);
  const reports: GameReread[] = [];
  for (const game of targets) {
    // On apply, read each game's rows at the moment it is processed, not the
    // rows loaded at start-up: a long run should work from current data.
    const scores = apply ? await currentScores(game.id) : (snapshot.scores[game.id] ?? []);
    if (scores.length === 0) continue;
    const reread = await rereadGame(game, scores, {
      skipUntaught: flag("--skip-untaught"),
      includeFailed: flag("--include-failed"),
      batchSize,
      ...(apply ? { onBatch: (rows) => writeRereadBatch(getDb(), game, rows) } : {}),
    });
    logEvent("score reread", rereadLogFields(reread, mode));
    reports.push(reread);
  }
  await shutdownGameCodeSandbox();
  reports.sort((a, b) => b.legacyRows + b.failedRows - (a.legacyRows + a.failedRows));

  printReport(reports, flag("--markdown"));
  const sum = (pick: (r: GameReread) => number) => reports.reduce((n, r) => n + pick(r), 0);
  logEvent("score reread summary", {
    kind: "score_reread_summary",
    mode,
    games: reports.length,
    legacy_rows: sum((r) => r.legacyRows),
    failed_rows: sum((r) => r.failedRows),
    decided: sum((r) => r.rows.length),
    deferred: sum((r) => r.deferred),
    skipped_untaught: sum((r) => r.skippedUntaught),
    skipped_already_read: sum((r) => r.skippedAlreadyRead),
    skipped_picked: sum((r) => r.skippedPicked),
    written: sum((r) => r.written),
    changed_since_read: sum((r) => r.changedSinceRead),
  });
  if (apply) {
    console.log(
      `wrote ${sum((r) => r.written)} rows; ${sum((r) => r.changedSinceRead)} changed while this ran and were left alone; ${sum((r) => r.deferred)} not decided (run again)`,
    );
  } else {
    console.log("dry run: nothing was written. Re-run with --apply to write these changes.");
  }

  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify({ mode, source, reports }, null, 2));
}

async function currentScores(gameId: string): Promise<RereadScore[]> {
  const rows = await getDb()
    .select()
    .from(gameScores)
    .where(eq(gameScores.gameId, gameId))
    .orderBy(gameScores.periodKey, gameScores.userId);
  return rows.map((s) => ({
    userId: s.userId,
    periodKey: s.periodKey,
    scoreRaw: s.scoreRaw,
    scoreValue: s.scoreValue === null ? null : Number(s.scoreValue),
    parseStatus: s.parseStatus,
    scoreSource: s.scoreSource,
    codeVersion: s.codeVersion,
  }));
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await shutdownGameCodeSandbox();
    process.exit(1);
  });
