#!/usr/bin/env node
// Migration smoke for CI: fresh database, apply every Drizzle migration, apply
// again (must be a no-op), and the bookkeeping row count must equal the number
// of .sql files. Runs against in-memory PGlite (Postgres 17, same major as
// prod) instead of a postgres service container — the container cost ~11s to
// start on every run and the migrations themselves take ~1s. Journal ↔ file
// consistency is the repo-root scripts/check-drizzle-journal.mjs, run just before this.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const expected = readdirSync(migrationsFolder).filter((f) => f.endsWith(".sql")).length;

const client = new PGlite();
const db = drizzle(client);

async function count() {
  const r = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  return r.rows[0].n;
}

const t0 = performance.now();
await migrate(db, { migrationsFolder });
const first = await count();
await migrate(db, { migrationsFolder });
const second = await count();
await client.close();

console.log(
  `applied=${first} re-applied=${second} expected=${expected} (${Math.round(performance.now() - t0)}ms)`,
);
if (first !== expected || second !== expected) {
  console.error("migration smoke failed: journal/file/bookkeeping counts differ");
  process.exit(1);
}
