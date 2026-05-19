/**
 * Backfill thumbnails for `kind = 'link'` items that predate the resolve-on-create
 * logic. Iterates items where `content` is missing every thumbnail field
 * (`image`, `imageProxy`, `thumbnailUrl`), runs `resolveLinkPreview()` against
 * each URL, and merges the result into `items.content`.
 *
 * Usage:
 *   pnpm --filter @workshop/backend exec tsx scripts/backfill-link-thumbnails.ts [--dry-run] [--limit=N] [--id=<uuid>]
 *
 * `DATABASE_URL` and `SESSION_SECRET` must be set. To target prod:
 *   DATABASE_URL=$(aws ssm get-parameter --name /workshop-prod/db/url \
 *     --with-decryption --query Parameter.Value --output text) \
 *     SESSION_SECRET=$(node -e "console.log('a'.repeat(32))") \
 *     pnpm --filter @workshop/backend exec tsx scripts/backfill-link-thumbnails.ts
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { items } from "../src/db/schema.js";
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

const LINK_PREVIEW_KEYS = [
  "source",
  "sourceId",
  "image",
  "imageProxy",
  "thumbnailUrl",
  "siteName",
  "title",
  "description",
] as const;

type LinkPreviewResult = Awaited<ReturnType<typeof resolveLinkPreview>>;

function mergeContent(
  current: Record<string, unknown> | null,
  preview: LinkPreviewResult,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const k of LINK_PREVIEW_KEYS) delete next[k];
  next.source = "link_preview";
  next.sourceId = preview.finalUrl;
  if (preview.image) next.image = preview.image;
  if (preview.imageProxy) next.imageProxy = preview.imageProxy;
  const thumbnail = preview.imageProxy ?? preview.image ?? preview.favicon;
  if (thumbnail) next.thumbnailUrl = thumbnail;
  if (preview.siteName) next.siteName = preview.siteName;
  if (preview.title) next.title = preview.title;
  if (preview.description) next.description = preview.description;
  return next;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = getDb();

  const missing = sql`(${items.content}->>'image' IS NULL
    AND ${items.content}->>'imageProxy' IS NULL
    AND ${items.content}->>'thumbnailUrl' IS NULL)`;

  const where = args.id
    ? eq(items.id, args.id)
    : and(eq(items.kind, "link"), isNull(items.archivedAt), sql`${items.url} IS NOT NULL`, missing);

  const baseQuery = db
    .select({
      id: items.id,
      url: items.url,
      content: items.content,
    })
    .from(items)
    .where(where);

  const candidates = args.limit ? await baseQuery.limit(args.limit) : await baseQuery;

  console.log(
    `[backfill] candidates: ${candidates.length}${args.dryRun ? " (dry-run)" : ""}${args.id ? ` (id=${args.id})` : ""}`,
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let unchanged = 0;

  for (const row of candidates) {
    const url = row.url;
    if (!url) {
      skipped++;
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      console.log(`[skip] ${row.id} invalid url: ${url}`);
      skipped++;
      continue;
    }

    let preview: LinkPreviewResult;
    try {
      preview = await resolveLinkPreview(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof SsrfBlockedError ? "ssrf" : "fetch";
      console.log(`[fail:${kind}] ${row.id} ${url} -> ${msg}`);
      failed++;
      continue;
    }

    const merged = mergeContent(row.content as Record<string, unknown> | null, preview);
    const hasThumb = Boolean(merged.image || merged.imageProxy || merged.thumbnailUrl);
    const tag = hasThumb ? "ok" : "no-thumb";

    if (args.dryRun) {
      console.log(
        `[dry:${tag}] ${row.id} ${url} -> image=${preview.image ?? "-"} title=${preview.title ?? "-"}`,
      );
      if (hasThumb) ok++;
      else unchanged++;
      continue;
    }

    await db
      .update(items)
      .set({ content: merged, updatedAt: new Date() })
      .where(eq(items.id, row.id));
    console.log(
      `[upd:${tag}] ${row.id} ${url} -> image=${preview.image ?? "-"} title=${preview.title ?? "-"}`,
    );
    if (hasThumb) ok++;
    else unchanged++;
  }

  console.log(
    `[backfill] done: ok=${ok} no-thumb=${unchanged} failed=${failed} skipped=${skipped}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
