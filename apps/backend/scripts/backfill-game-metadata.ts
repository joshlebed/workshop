/**
 * Backfill display metadata on `games` catalog rows that predate the
 * resolve-on-create logic. For each candidate row it runs
 * `resolveLinkPreview()` against the game URL and:
 *
 *  - upgrades `icon_url` to the page's real favicon (apple-touch-icon etc.)
 *    when the row has no icon or only the Google s2 fallback the migration
 *    0028 backfill wrote;
 *  - repairs `title` for non-catalog games (`game_key IS NULL`) still wearing
 *    the hostname default, using the page title distilled by
 *    `cleanGameTitle`.
 *
 * Catalog games keep their canonical titles. Safe to re-run.
 *
 * Usage:
 *   pnpm --filter @workshop/backend exec tsx scripts/backfill-game-metadata.ts [--dry-run] [--limit=N] [--id=<uuid>]
 *
 * `DATABASE_URL` and `SESSION_SECRET` must be set. To target prod:
 *   DATABASE_URL=$(aws ssm get-parameter --name /workshop-prod/db/url \
 *     --with-decryption --query Parameter.Value --output text) \
 *     SESSION_SECRET=$(node -e "console.log('a'.repeat(32))") \
 *     pnpm --filter @workshop/backend exec tsx scripts/backfill-game-metadata.ts
 */

import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { games } from "../src/db/schema.js";
import { cleanGameTitle, defaultGameIconUrl } from "../src/lib/gameCatalog.js";
import { SsrfBlockedError } from "../src/lib/ssrf-guard.js";
import { resolveLinkPreview } from "../src/routes/v1/link-preview.js";

interface Args {
  dryRun: boolean;
  limit: number | null;
  id: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, limit: null, id: null };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--limit=")) out.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--id=")) out.id = a.slice("--id=".length);
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

const GOOGLE_FAVICON_PREFIX = "https://www.google.com/s2/favicons?";

function hostDefaultTitle(normalizedUrl: string): string {
  return normalizedUrl.split("/")[0] ?? normalizedUrl;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = getDb();

  const baseQuery = db
    .select({
      id: games.id,
      url: games.url,
      normalizedUrl: games.normalizedUrl,
      title: games.title,
      iconUrl: games.iconUrl,
      gameKey: games.gameKey,
    })
    .from(games)
    .where(args.id ? eq(games.id, args.id) : undefined);

  const rows = args.limit ? await baseQuery.limit(args.limit) : await baseQuery;

  console.log(`[backfill] games: ${rows.length}${args.dryRun ? " (dry-run)" : ""}`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    const wantsIcon = row.iconUrl === null || row.iconUrl.startsWith(GOOGLE_FAVICON_PREFIX);
    const wantsTitle = row.gameKey === null && row.title === hostDefaultTitle(row.normalizedUrl);
    if (!wantsIcon && !wantsTitle) {
      unchanged++;
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(row.url);
    } catch {
      console.log(`[fail:url] ${row.id} invalid url: ${row.url}`);
      failed++;
      continue;
    }

    let preview: Awaited<ReturnType<typeof resolveLinkPreview>> | null = null;
    try {
      preview = await resolveLinkPreview(parsed);
    } catch (e) {
      const kind = e instanceof SsrfBlockedError ? "ssrf" : "fetch";
      console.log(
        `[warn:${kind}] ${row.id} ${row.url} -> ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const patch: { title?: string; iconUrl?: string } = {};
    const nextIcon = preview?.favicon ?? defaultGameIconUrl(row.normalizedUrl);
    if (wantsIcon && nextIcon !== row.iconUrl) patch.iconUrl = nextIcon;
    const nextTitle = wantsTitle ? cleanGameTitle(preview?.title) : null;
    if (nextTitle && nextTitle !== row.title) patch.title = nextTitle;

    if (Object.keys(patch).length === 0) {
      unchanged++;
      continue;
    }

    const summary = `title=${patch.title ?? "-"} icon=${patch.iconUrl ?? "-"}`;
    if (args.dryRun) {
      console.log(`[dry] ${row.id} ${row.url} -> ${summary}`);
      updated++;
      continue;
    }

    await db.update(games).set(patch).where(eq(games.id, row.id));
    console.log(`[upd] ${row.id} ${row.url} -> ${summary}`);
    updated++;
  }

  console.log(`[backfill] done: updated=${updated} unchanged=${unchanged} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
