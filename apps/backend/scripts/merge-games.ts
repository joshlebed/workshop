/**
 * Combine two catalog rows that are the same game (`lib/gameMerge.ts`).
 * Everything on the extra row — scores, players' My Games entries, reactions,
 * pokes, list items, reports — moves to the main row, then the extra row is
 * deleted. Where a player has a score for the same day on both, the main row's
 * score is kept. If only the extra row has a parser, its code moves too.
 *
 * Add the extra address to `GAME_URL_ALIASES` first (same PR), so nobody can
 * re-create it. See docs/catalog-ops-runbook.md → "Duplicate games".
 *
 * DRY RUN BY DEFAULT.
 *
 *   DATABASE_URL=… pnpm --filter @workshop/backend run admin:merge-games \
 *     --from=playplain.app/play --into=playplain.app
 *   … --apply --by=<admin email> --note="<why>"
 *
 * `--from` / `--into` take a game's uuid or its exact stored `normalized_url`
 * (not passed through URL normalization, which would map an alias to the main
 * address).
 */

import { eq, or } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { games, users } from "../src/db/schema.js";
import { isAdminUser } from "../src/lib/admin.js";
import { shutdownGameCodeSandbox } from "../src/lib/gameCode/runtime.js";
import { applyGameMerge, type GameMergePlan, planGameMerge } from "../src/lib/gameMerge.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findGameId(ref: string): Promise<string> {
  const rows = await getDb()
    .select({ id: games.id })
    .from(games)
    .where(
      UUID.test(ref)
        ? or(eq(games.id, ref), eq(games.normalizedUrl, ref))
        : eq(games.normalizedUrl, ref),
    );
  if (rows.length !== 1 || !rows[0]) fail(`${ref} matched ${rows.length} games`);
  return rows[0].id;
}

function describe(plan: GameMergePlan): string {
  const code = {
    copy: `its parser and formatter move to ${plan.into.normalizedUrl}`,
    keep: `${plan.into.normalizedUrl} keeps its own parser`,
    none: "neither has a parser",
  }[plan.code];
  return [
    `${plan.from.title} (${plan.from.normalizedUrl}) → ${plan.into.title} (${plan.into.normalizedUrl})`,
    `  scores:   ${plan.scores.move} move, ${plan.scores.keepInto} dropped (same player and day already on the main game)`,
    `  players:  ${plan.players.move} move, ${plan.players.alreadyThere} already had the main game`,
    `  other:    ${plan.reactions} reactions, ${plan.pokes} pokes, ${plan.items} list items, ${plan.reports} reports`,
    `  code:     ${code}`,
  ].join("\n");
}

async function main() {
  const fromRef = arg("--from");
  const intoRef = arg("--into");
  if (!fromRef || !intoRef)
    fail("usage: --from=<url|uuid> --into=<url|uuid> [--apply --by=<email> --note=<why>]");
  const apply = process.argv.includes("--apply");
  const fromId = await findGameId(fromRef);
  const intoId = await findGameId(intoRef);

  if (!apply) {
    console.log(describe(await planGameMerge(getDb(), fromId, intoId)));
    console.log("\ndry run, nothing written");
    return;
  }
  const email = arg("--by");
  const note = arg("--note");
  if (!email || !note) fail('--apply needs --by=<your account email> and --note="<why>"');
  const [author] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email));
  if (!author) fail(`no user with email ${email}`);
  if (!isAdminUser(author)) fail(`${email} is not an admin account`);
  const plan = await applyGameMerge(getDb(), { fromId, intoId, authoredBy: author.id, note });
  console.log(describe(plan));
  console.log(`\nmerged; ${plan.from.normalizedUrl} is deleted`);
}

main()
  .then(async () => {
    await shutdownGameCodeSandbox();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
