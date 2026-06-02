/**
 * Delete "resultless" leaderboard scores — rows that render as a bare "Played"
 * placeholder with no actual result.
 *
 * Why: some games (Daily Tens) share via the iOS share sheet with a single item
 * provider conforming to both `public.url` and `public.text`. Before the
 * share-extension fix (#256) and the post-time guards (#253/#255), the extension
 * captured only the referral URL (e.g. `https://dailytens.com/?ref=944415`) and
 * dropped the 🏆/❌ grid. We stored that bare link as `score_raw`, so the row has
 * no postable result and renders as a "Played" row on the leaderboard. The
 * backend's old "first number anywhere" parser also pulled the `?ref=<id>` digits
 * into `score_value`, poisoning rankings.
 *
 * Definition of invalid (the single source of truth): a row is invalid iff the
 * app's own `summarizeScoreBody(item, entry)` returns `null` — i.e. exactly the
 * condition under which the leaderboard renders "Played" instead of a score
 * (apps/workshop/app/list/[id]/game/[itemId].tsx). We import the real rendering
 * function rather than reimplement it, so "what we delete" can never drift from
 * "what renders as nothing". A genuinely valid score never renders as "Played",
 * so this preserves all valid data.
 *
 * Default is a dry run that prints every row it WOULD delete. Pass `--apply` to
 * actually delete. Idempotent — re-running finds nothing once clean.
 *
 *   AWS_PROFILE=workshop-prod DATABASE_URL=$(aws ssm get-parameter \
 *     --name /workshop-prod/db/url --with-decryption --region us-east-1 \
 *     --query Parameter.Value --output text) \
 *     pnpm --filter @workshop/backend exec tsx scripts/cleanup-invalid-scores.ts [--apply]
 */

import type { Item } from "@workshop/shared";
import { sql } from "drizzle-orm";
// The exact function the leaderboard uses to decide score-vs-"Played". Imported
// from the RN app so "what we delete" can never drift from "what renders as
// nothing". Cross-package: tsc resolves the named export from the `.ts` source
// for types, but at runtime tsx loads `apps/workshop` (not `type: module`) as
// CJS, collapsing the named exports under `default` — so fall back to it.
import * as scoresSummaryMod from "../../workshop/src/lib/scoresSummary.js";
import { getDb } from "../src/db/client.js";
import { itemScores, items, lists, users } from "../src/db/schema.js";

const summarizeScoreBody =
  scoresSummaryMod.summarizeScoreBody ??
  (scoresSummaryMod as unknown as { default: typeof scoresSummaryMod }).default.summarizeScoreBody;

interface ScoreRow {
  itemId: string;
  userId: string;
  periodKey: string;
  scoreRaw: string;
  scoreValue: string | null;
  createdAt: Date;
  itemTitle: string;
  itemUrl: string | null;
  itemContent: unknown;
  listName: string;
  modules: string[] | null;
  email: string | null;
  displayName: string | null;
}

/** Reconstruct the minimal `Item` shape `summarizeScoreBody` reads. */
function toItem(row: ScoreRow): Item {
  const c = (row.itemContent ?? {}) as Record<string, unknown>;
  return {
    id: row.itemId,
    listId: "",
    kind: "link" as Item["kind"],
    title: row.itemTitle,
    url: row.itemUrl,
    note: null,
    content: c as Item["content"],
    position: null,
    addedBy: "",
    completed: false,
    completedAt: null,
    completedBy: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}

function isInvalid(row: ScoreRow): boolean {
  const item = toItem(row);
  const body = summarizeScoreBody(item, {
    scoreRaw: row.scoreRaw,
    scoreValue: row.scoreValue === null ? null : Number(row.scoreValue),
  });
  // Renders as "Played" ⇔ body is null/blank ⇔ invalid resultless row.
  return body === null || body.trim().length === 0;
}

function preview(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 70 ? `${oneLine.slice(0, 67)}…` : oneLine;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "[cleanup] APPLY mode — invalid rows WILL be deleted"
      : "[cleanup] dry run — no writes. Pass --apply to delete.",
  );

  const db = getDb();

  const rows = (await db
    .select({
      itemId: itemScores.itemId,
      userId: itemScores.userId,
      periodKey: itemScores.periodKey,
      scoreRaw: itemScores.scoreRaw,
      scoreValue: itemScores.scoreValue,
      createdAt: itemScores.createdAt,
      itemTitle: items.title,
      itemUrl: items.url,
      itemContent: items.content,
      listName: lists.name,
      modules: lists.modules,
      email: users.email,
      displayName: users.displayName,
    })
    .from(itemScores)
    .innerJoin(items, sql`${items.id} = ${itemScores.itemId}`)
    .innerJoin(lists, sql`${lists.id} = ${items.listId}`)
    .innerJoin(users, sql`${users.id} = ${itemScores.userId}`)) as ScoreRow[];

  console.log(`[cleanup] scanned ${rows.length} item_scores rows`);

  const invalid = rows.filter(isInvalid);
  const valid = rows.length - invalid.length;
  console.log(`[cleanup] valid (kept): ${valid}    invalid (renders "Played"): ${invalid.length}`);

  if (invalid.length === 0) {
    console.log("[cleanup] nothing to delete.");
    return;
  }

  console.log("\n[cleanup] rows that WILL be deleted:\n");
  for (const r of invalid) {
    const who = r.displayName || r.email || r.userId.slice(0, 8);
    console.log(
      `  • "${r.itemTitle}" (${r.listName}) — ${who} — period ${r.periodKey}\n` +
        `      scoreRaw: ${JSON.stringify(preview(r.scoreRaw))}  scoreValue: ${r.scoreValue ?? "∅"}  created ${r.createdAt.toISOString()}`,
    );
  }

  if (!apply) {
    console.log(`\n[cleanup] dry run complete — ${invalid.length} rows would be deleted.`);
    return;
  }

  let deleted = 0;
  for (const r of invalid) {
    await db
      .delete(itemScores)
      .where(
        sql`${itemScores.itemId} = ${r.itemId} AND ${itemScores.userId} = ${r.userId} AND ${itemScores.periodKey} = ${r.periodKey}`,
      );
    deleted++;
  }
  console.log(`\n[cleanup] deleted ${deleted} invalid rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[cleanup] failed", err);
    process.exit(1);
  });
