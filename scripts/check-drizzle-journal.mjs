#!/usr/bin/env node
// Verify apps/backend/drizzle/meta/_journal.json is in sync with the .sql
// files on disk. Catches: (a) a journal entry whose .sql file was deleted or
// renamed, (b) a .sql file with no journal entry, (c) journal `when`
// timestamps out of order (drizzle relies on these for its skip-already-applied
// logic — if they regress, earlier migrations re-run and fail).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, "..", "apps", "backend", "drizzle");

const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8"));

const sqlFiles = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

const journalTags = journal.entries.map((e) => e.tag).sort();

const missingSql = journalTags.filter((t) => !sqlFiles.includes(t));
const orphanSql = sqlFiles.filter((f) => !journalTags.includes(f));

const errors = [];
if (missingSql.length > 0) {
  errors.push(`journal references missing .sql file(s): ${missingSql.join(", ")}`);
}
if (orphanSql.length > 0) {
  errors.push(`.sql file(s) not referenced by journal: ${orphanSql.join(", ")}`);
}

let prev = -Infinity;
for (const e of journal.entries) {
  if (e.when <= prev) {
    errors.push(
      `journal entry ${e.tag} has when=${e.when} <= previous entry (${prev}); timestamps must be strictly increasing`,
    );
  }
  prev = e.when;
}

if (errors.length > 0) {
  console.error("drizzle journal check failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `drizzle journal OK (${journal.entries.length} entries, all files present, timestamps monotonic)`,
);
