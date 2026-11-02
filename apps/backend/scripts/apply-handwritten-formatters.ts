/**
 * Install the hand-written `format` code in `lib/gameCode/handwritten.ts` on
 * the games it names — `admin:game-code --format=…` for every entry at once.
 *
 * Each game goes through the same gate as the single-game script
 * (`planGameCodeChange` → `decideGameCodeChange`): the candidate must
 * reproduce every stored score with a known result and render every example
 * in the entry as reviewed. Parse code is never touched: a game with none is
 * skipped (give it a parser with `admin:game-code --parse` first). A game whose
 * stored `format_code` already equals the entry is skipped, so re-running is a
 * no-op. Stored scores are NOT rewritten — see `admin:reformat-scores` for that.
 *
 * DRY RUN BY DEFAULT.
 *
 *   DATABASE_URL=$(aws ssm get-parameter --name /workshop-prod/db/url --with-decryption \
 *     --query Parameter.Value --output text) \
 *     pnpm --filter @workshop/backend run admin:handwritten-formatters
 *   … --apply --by=<admin email> --note="<why>"
 *
 * Flags:
 *   --apply        write (needs --by and --note)
 *   --game=<ref>   only the entry with this `ref` (repeatable, comma-separated)
 */

import { eq, or } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { type DbGame, games, users } from "../src/db/schema.js";
import { isAdminUser } from "../src/lib/admin.js";
import {
  applyGameCodeChange,
  decideGameCodeChange,
  planGameCodeChange,
} from "../src/lib/gameCode/admin.js";
import { HANDWRITTEN_FORMATTERS } from "../src/lib/gameCode/handwritten.js";
import { shutdownGameCodeSandbox } from "../src/lib/gameCode/runtime.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}
const flag = (name: string) => process.argv.includes(name);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function findGame(ref: string): Promise<DbGame | null> {
  const rows = await getDb()
    .select()
    .from(games)
    .where(or(eq(games.gameKey, ref), eq(games.normalizedUrl, ref)));
  if (rows.length > 1) fail(`${ref} matched ${rows.length} games`);
  return rows[0] ?? null;
}

async function main() {
  const apply = flag("--apply");
  const only = new Set((arg("--game") ?? "").split(",").filter(Boolean));
  const email = arg("--by");
  const note = arg("--note");
  let authorId: string | null = null;
  if (apply) {
    if (!email || !note) fail('--apply needs --by=<your account email> and --note="<why>"');
    const [author] = await getDb()
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email));
    if (!author) fail(`no user with email ${email}`);
    if (!isAdminUser(author)) fail(`${email} is not an admin account`);
    authorId = author.id;
  }

  let written = 0;
  let refused = 0;
  for (const entry of HANDWRITTEN_FORMATTERS) {
    if (only.size > 0 && !only.has(entry.ref)) continue;
    const game = await findGame(entry.ref);
    if (!game) {
      console.log(`${entry.title}: no games row for ${entry.ref} — skipped`);
      continue;
    }
    if (game.formatCode === entry.format) {
      console.log(`${entry.title}: already current (v${game.codeVersion})`);
      continue;
    }
    if (game.parseCode === null) {
      console.log(`${entry.title}: has no parse code; a formatter needs a parser first — skipped`);
      continue;
    }
    const candidate = { parseCode: game.parseCode, formatCode: entry.format };
    const plan = await planGameCodeChange(getDb(), game, candidate, entry.examples);
    const decision = decideGameCodeChange(plan);
    if (!decision.write) {
      refused += 1;
      console.log(`${entry.title}: refused (${decision.reason})`);
      for (const m of [...plan.storedMismatches, ...plan.exampleMismatches].slice(0, 10)) {
        console.log(
          `  [${m.step}] ${JSON.stringify(m.raw.slice(0, 60))} → ${JSON.stringify(m.actual)}`,
        );
      }
      continue;
    }
    console.log(
      `${entry.title}: ok against ${plan.storedScores} stored scores and ${entry.examples.length} examples${apply ? "" : " (dry run)"}`,
    );
    if (!apply) continue;
    const { version } = await applyGameCodeChange(getDb(), {
      gameId: game.id,
      candidate,
      source: "operator",
      authoredBy: authorId,
      note: note ?? "",
      examples: entry.examples,
    });
    written += 1;
    console.log(`  wrote ${entry.title} code version ${version}`);
  }
  console.log(
    `\n${written} written, ${refused} refused${apply ? "" : " — dry run, nothing written"}`,
  );
  if (refused > 0) process.exitCode = 1;
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
