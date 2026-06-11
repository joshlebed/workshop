import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getConfig } from "../lib/config.js";

async function main() {
  const { databaseUrl } = getConfig();
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  const client = postgres(databaseUrl, {
    ssl: isLocalDb ? false : "require",
    max: 1,
  });
  const db = drizzle(client);
  // One-time fixup: migration 0031 shipped with a hand-mangled journal
  // timestamp (1781590000000 — 2026-06-16, in the future at the time). The
  // migrator records that value as created_at and skips any migration whose
  // generate-time `when` is older than the newest applied created_at, so
  // every migration generated before that date would silently not apply.
  // The journal entry is corrected to 1781204759242 (just after 0030); this
  // rewrites the recorded row on DBs that already applied the bogus value
  // (prod + Neon branches forked from it). No-op everywhere else, and the
  // catch covers fresh DBs where the bookkeeping table doesn't exist yet.
  // Safe to delete once prod has run it.
  await client`
    UPDATE drizzle.__drizzle_migrations SET created_at = 1781204759242
    WHERE created_at = 1781590000000
  `.catch(() => {});
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error("migration failed", err);
  process.exit(1);
});
