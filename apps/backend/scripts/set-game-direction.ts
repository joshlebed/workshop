/**
 * Set a game's score direction — `desc` (higher wins) or `asc` (lower wins) —
 * as an operator, with a `game_direction_revisions` row (who, when, why,
 * before → after). DRY RUN BY DEFAULT: it prints the change and how many
 * days' winners it would replace, and writes nothing.
 *
 * Users change a direction in the app under the two-user rule; this is for a
 * direction that is simply wrong (e.g. a "lower is better" default nobody
 * chose). It changes no stored score: boards re-rank on the next read.
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(aws ssm get-parameter \
 *     --name /workshop-prod/db/url --with-decryption --query Parameter.Value --output text) \
 *     pnpm --filter @workshop/backend run admin:game-direction \
 *       --game=geohistory.gg --to=desc --by=<admin user id or email> --note="<why>" [--apply]
 *
 * Flags:
 *   --game=<id|key|url>   the game: its uuid, registry key, or normalized_url
 *   --to=asc|desc         the direction to set
 *   --by=<id|email>       your admin account (required, also for a dry run)
 *   --note="<why>"        recorded on the revision (required with --apply)
 *   --apply               write the change
 */

import { eq, or } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { type DbGame, games, users } from "../src/db/schema.js";
import { isAdminUser } from "../src/lib/admin.js";
import { applyDirectionChange, planDirectionChange } from "../src/lib/gameDirectionAdmin.js";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const isUuid = (ref: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(ref);

async function findGame(ref: string): Promise<DbGame> {
  const rows = await getDb()
    .select()
    .from(games)
    .where(
      isUuid(ref) ? eq(games.id, ref) : or(eq(games.gameKey, ref), eq(games.normalizedUrl, ref)),
    );
  if (rows.length !== 1 || !rows[0]) {
    fail(`--game=${ref} matched ${rows.length} games (use the uuid, game_key or normalized_url)`);
  }
  return rows[0];
}

const describe = (d: string) => (d === "asc" ? "asc (lower wins)" : "desc (higher wins)");

async function main() {
  const ref = arg("--game");
  const to = arg("--to");
  const by = arg("--by");
  if (!ref || (to !== "asc" && to !== "desc")) {
    fail(
      "usage: admin:game-direction --game=<id|key|url> --to=asc|desc --by=<admin> [--note=…] [--apply]",
    );
  }
  if (!by) fail("--by=<your admin user id or email> is required");
  const [author] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isUuid(by) ? eq(users.id, by) : eq(users.email, by));
  if (!author) fail(`no user ${by}`);
  if (!isAdminUser(author)) fail(`${by} is not an admin account`);

  const game = await findGame(ref);
  const plan = await planDirectionChange(getDb(), game, to);
  console.log(`${game.title} (${game.id})`);
  console.log(`  direction: ${describe(plan.from)} → ${describe(plan.to)}`);
  if (plan.from === plan.to) {
    console.log("nothing to change: the game already has that direction");
    return;
  }
  console.log(
    `  winners change on ${plan.daysWinnerChanges} of ${plan.contestedDays} days with two or more scores`,
  );
  console.log(`  pending two-user requests cleared: ${plan.pendingRequests}`);
  if (!process.argv.includes("--apply")) {
    console.log("dry run: nothing was written. Re-run with --apply and --note to write it.");
    return;
  }

  const note = arg("--note");
  if (!note) fail('writing needs --note="<why>"');
  const result = await applyDirectionChange(getDb(), {
    gameId: game.id,
    from: plan.from,
    to: plan.to,
    authoredBy: author.id,
    note,
  });
  if (result.stale)
    fail("the game's direction changed while this ran; nothing written — run again");
  console.log(`wrote ${game.title}: ${plan.from} → ${plan.to} (revision ${result.revisionId})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
