import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { lists, users } from "../db/schema.js";
import { imageStorageAvailable } from "../lib/imageStorage.js";
import { decodeImageDataUrl, readImage, storeImage } from "../lib/images.js";
import { logger } from "../lib/logger.js";

/** Stop starting new rows after this long; the Lambda times out at 15s. */
const BUDGET_MS = 9_000;

type Db = ReturnType<typeof getDb>;

/**
 * The two places a picture used to be stored inline, and where each now goes.
 * `commit` points the row at the stored copy and clears the inline picture,
 * but only if the row still holds exactly the picture that was copied.
 */
const TARGETS = [
  {
    name: "users.avatar_url",
    kind: "avatars",
    table: users,
    inline: users.avatarUrl,
    pending: and(isNotNull(users.avatarUrl), isNull(users.avatarKey)),
    commit: async (db: Db, id: string, key: string, inline: string) =>
      (
        await db
          .update(users)
          .set({ avatarKey: key, avatarUrl: null })
          .where(
            and(
              eq(users.id, id),
              isNull(users.avatarKey),
              sql`md5(${users.avatarUrl}) = md5(${inline})`,
            ),
          )
          .returning({ id: users.id })
      ).length > 0,
  },
  {
    name: "lists.cover_photo_url",
    kind: "list-covers",
    table: lists,
    inline: lists.coverPhotoUrl,
    pending: and(isNotNull(lists.coverPhotoUrl), isNull(lists.coverPhotoKey)),
    commit: async (db: Db, id: string, key: string, inline: string) =>
      (
        await db
          .update(lists)
          .set({ coverPhotoKey: key, coverPhotoUrl: null })
          .where(
            and(
              eq(lists.id, id),
              isNull(lists.coverPhotoKey),
              sql`md5(${lists.coverPhotoUrl}) = md5(${inline})`,
            ),
          )
          .returning({ id: lists.id })
      ).length > 0,
  },
] as const;

interface BackfillResult {
  dryRun: boolean;
  /** Rows moved (or, in a dry run, rows that would be). */
  moved: number;
  /** Rows whose inline value is not a picture, or whose copy did not read back identical. */
  unreadable: number;
  /** Rows still holding an inline picture when the run ended. */
  remaining: number;
}

/**
 * Moves pictures still stored inline as `data:` URLs into image storage.
 *
 * Run by hand after the bucket exists (`docs/image-storage-migration.md`):
 * `{ "job": "image-backfill", "dryRun": true }` reports, without `dryRun` it
 * moves. Safe to re-run: it touches only rows that still have an inline
 * picture and no key, and reports how many are left.
 *
 * A row's inline picture is cleared only after the object has been read back
 * from storage and matches byte for byte, and only if the row still holds the
 * picture that was copied (its owner may upload a new one meanwhile).
 */
export async function runImageBackfillJob(
  options: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun === true;
  const result: BackfillResult = { dryRun, moved: 0, unreadable: 0, remaining: 0 };
  if (!imageStorageAvailable()) {
    logger.warn("image backfill skipped: no image storage configured");
    return result;
  }
  const db = getDb();
  const started = Date.now();

  for (const target of TARGETS) {
    const { pending } = target;
    const ids = await db.select({ id: target.table.id }).from(target.table).where(pending);

    for (const { id } of ids) {
      if (Date.now() - started > BUDGET_MS) break;
      const [row] = await db
        .select({ inline: target.inline })
        .from(target.table)
        .where(and(eq(target.table.id, id), pending))
        .limit(1);
      if (!row?.inline) continue;

      const original = decodeImageDataUrl(row.inline);
      if (!original) {
        result.unreadable++;
        logger.warn("image backfill: inline value is not a picture", { target: target.name, id });
        continue;
      }
      if (dryRun) {
        result.moved++;
        continue;
      }
      const key = await storeImage(target.kind, id, row.inline);
      const copy = key ? await readImage(key) : null;
      if (!key || !copy?.body.equals(original.body)) {
        result.unreadable++;
        logger.warn("image backfill: copy did not read back identical", {
          target: target.name,
          id,
        });
        continue;
      }
      if (await target.commit(db, id, key, row.inline)) result.moved++;
    }

    const [left] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(target.table)
      .where(pending);
    result.remaining += left?.n ?? 0;
  }

  logger.info("image backfill finished", { ...result });
  return result;
}
