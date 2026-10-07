/**
 * Set a game's stored parse / format code (the JavaScript the QuickJS sandbox
 * runs — contract in src/lib/gameCode/README.md) without a deploy.
 *
 * It refuses to write unless the new code reproduces what the game's stored
 * scores are known to parse to, and it records a `game_code_revisions` row
 * (who, when, why, both code blocks, the examples). It never rewrites stored
 * scores: only posts made after the change are parsed by the new code.
 *
 * Point it at prod with the SSM connection string:
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(aws ssm get-parameter \
 *     --name /workshop-prod/db/url --with-decryption --query Parameter.Value --output text) \
 *     pnpm --filter @workshop/backend run admin:game-code --game=krillion.io --show
 *
 * Flags:
 *   --game=<id|key|url>     the game: its uuid, registry key, or normalized_url
 *   --show                  print the current code, version and history; write nothing
 *   --parse=<file.js>       new parse code (omit to keep the current one)
 *   --format=<file.js>      new format code (omit to keep the current one)
 *   --no-format             remove the format code (rows show the cleaned raw text)
 *   --revert=<version>      use the code that version held, as a new version
 *   --examples=<file.json>  extra labelled shares: [{ "raw", "expected", "expectedSummary"? }]
 *   --dry                   validate and report; write nothing
 *   --accept-changes=<id>   write even though some stored scores read differently — for a
 *                           game whose stored values are known to be wrong. Run --dry
 *                           first, read the list, then pass the id it printed. The id
 *                           names that exact set of differences: if a score is posted or
 *                           edited in between, it no longer matches and nothing is written.
 *   --by=<email>            your account email (recorded as the author; must be an admin)
 *   --note="<why>"          recorded on the revision
 */

import { readFileSync } from "node:fs";
import { desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../src/db/client.js";
import { type DbGame, gameCodeRevisions, games, users } from "../src/db/schema.js";
import { isAdminUser } from "../src/lib/admin.js";
import {
  applyGameCodeChange,
  type CandidateCode,
  decideGameCodeChange,
  gameCodeAtVersion,
  planGameCodeChange,
} from "../src/lib/gameCode/admin.js";
import {
  type CodeExample,
  type CodeMismatch,
  shutdownGameCodeSandbox,
} from "../src/lib/gameCode/runtime.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}
const flag = (name: string) => process.argv.includes(name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const examplesSchema = z.array(
  z.object({
    raw: z.string(),
    expected: z.number().finite().nullable().optional(),
    expectedSummary: z.string().nullable().optional(),
  }),
);

function readExamples(file: string | null): CodeExample[] {
  if (!file) return [];
  const parsed = examplesSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) fail(`--examples: ${parsed.error.message}`);
  // exactOptionalPropertyTypes: drop the keys zod left as explicit undefined.
  return parsed.data.map((e) => ({
    raw: e.raw,
    ...(e.expected === undefined ? {} : { expected: e.expected }),
    ...(e.expectedSummary === undefined ? {} : { expectedSummary: e.expectedSummary }),
  }));
}

async function findGame(ref: string): Promise<DbGame> {
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ref);
  const rows = await db
    .select()
    .from(games)
    .where(isUuid ? eq(games.id, ref) : or(eq(games.gameKey, ref), eq(games.normalizedUrl, ref)));
  if (rows.length !== 1 || !rows[0]) {
    fail(`--game=${ref} matched ${rows.length} games (use the uuid, game_key or normalized_url)`);
  }
  return rows[0];
}

function describe(actual: CodeMismatch["actual"]): string {
  if (actual.kind === "score") return String(actual.value);
  if (actual.kind === "summary") return JSON.stringify(actual.text);
  if (actual.kind === "failed") {
    return `failed (${actual.reason}${actual.detail ? `: ${actual.detail}` : ""})`;
  }
  return actual.kind === "noResult" ? "no result" : "nothing";
}

function printMismatches(label: string, mismatches: CodeMismatch[]): void {
  if (mismatches.length === 0) return;
  console.log(`\n${label}: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 40)) {
    const expected = m.expected === null ? (m.step === "parse" ? "no result" : "∅") : m.expected;
    console.log(
      `  [${m.step}] expected ${expected}, got ${describe(m.actual)}  ${JSON.stringify(m.raw.slice(0, 80))}`,
    );
  }
  if (mismatches.length > 40) console.log(`  … and ${mismatches.length - 40} more`);
}

async function show(game: DbGame): Promise<void> {
  console.log(`${game.title} (${game.id}) — code version ${game.codeVersion}`);
  console.log(`\n--- parse_code ---\n${game.parseCode ?? "(none: untaught)"}`);
  console.log(
    `\n--- format_code ---\n${game.formatCode ?? "(none: rows show the cleaned raw text)"}`,
  );
  const history = await getDb()
    .select({
      version: gameCodeRevisions.version,
      source: gameCodeRevisions.source,
      note: gameCodeRevisions.note,
      createdAt: gameCodeRevisions.createdAt,
      author: users.email,
    })
    .from(gameCodeRevisions)
    .leftJoin(users, eq(users.id, gameCodeRevisions.authoredBy))
    .where(eq(gameCodeRevisions.gameId, game.id))
    .orderBy(desc(gameCodeRevisions.version));
  console.log("\n--- history ---");
  for (const h of history) {
    console.log(
      `v${h.version}  ${h.createdAt.toISOString()}  ${h.source}  ${h.author ?? "—"}  ${h.note ?? ""}`,
    );
  }
}

async function main() {
  const ref = arg("--game");
  if (!ref)
    fail(
      "usage: admin:game-code --game=<id|key|url> [--show | --parse=<file> …] (see the script header)",
    );
  const game = await findGame(ref);
  if (flag("--show")) return show(game);

  let candidate: CandidateCode = { parseCode: game.parseCode, formatCode: game.formatCode };
  const revert = arg("--revert");
  if (revert !== null) {
    const past = await gameCodeAtVersion(getDb(), game.id, Number(revert));
    if (!past) fail(`${game.title} has no version ${revert}`);
    candidate = past;
  }
  const parseFile = arg("--parse");
  const formatFile = arg("--format");
  if (parseFile) candidate = { ...candidate, parseCode: readFileSync(parseFile, "utf8") };
  if (formatFile) candidate = { ...candidate, formatCode: readFileSync(formatFile, "utf8") };
  if (flag("--no-format")) candidate = { ...candidate, formatCode: null };
  if (candidate.parseCode === game.parseCode && candidate.formatCode === game.formatCode) {
    fail("nothing to change: pass --parse, --format, --no-format or --revert");
  }

  const examples = readExamples(arg("--examples"));
  const plan = await planGameCodeChange(getDb(), game, candidate, examples);
  console.log(
    `${game.title}: checked against ${plan.storedScores} stored scores (${plan.storedWithExpectation} with a known result) and ${examples.length} examples`,
  );
  printMismatches("stored scores the new code reads differently", plan.storedMismatches);
  printMismatches("examples the new code gets wrong", plan.exampleMismatches);

  const accepted = arg("--accept-changes");
  const decision = decideGameCodeChange(plan, accepted);
  if (!decision.write) {
    const differing = plan.storedMismatches.length;
    const staleAcceptance =
      differing === 0
        ? "--accept-changes was given, but no stored score reads differently any more — re-run --dry"
        : `the stored scores that read differently are not the set you accepted (it is now --accept-changes=${plan.storedMismatchFingerprint}) — review the list above again`;
    const why = {
      sandbox_unavailable:
        "the sandbox could not run the code (worker failed to start or died) — nothing was checked; this says nothing about the code, try again",
      fails_examples: "the code fails its examples",
      changes_stored_scores:
        accepted === null
          ? `${differing} stored scores read differently (if every one of them is a stored value that was wrong, pass --accept-changes=${plan.storedMismatchFingerprint})`
          : staleAcceptance,
    }[decision.reason];
    console.log(`\nrefusing to write: ${why}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    decision.acceptedChanges === 0
      ? "validation passed"
      : `\n${decision.acceptedChanges} stored scores read differently, as accepted by --accept-changes`,
  );
  if (flag("--dry")) return console.log("--dry: nothing written");

  const email = arg("--by");
  const note = arg("--note");
  if (!email || !note) fail('writing needs --by=<your account email> and --note="<why>"');
  const [author] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email));
  if (!author) fail(`no user with email ${email}`);
  // The revision names its author; only an admin account may be one.
  if (!isAdminUser(author)) fail(`${email} is not an admin account`);

  const { version } = await applyGameCodeChange(getDb(), {
    gameId: game.id,
    candidate,
    source: "operator",
    authoredBy: author.id,
    note:
      plan.storedMismatches.length > 0
        ? `${note} (${plan.storedMismatches.length} stored scores read differently; accepted)`
        : note,
    examples,
  });
  console.log(`wrote ${game.title} code version ${version}`);
  console.log(
    "stored scores were not re-parsed: only new posts use this code (rows keep their code_version)",
  );
}

main()
  .then(async () => {
    await shutdownGameCodeSandbox();
    process.exit(process.exitCode ?? 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
