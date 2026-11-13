// Migration 0059 (users_display_name_check) on in-memory PGlite: migrate up to
// 0058, plant the bad shapes the constraint forbids, then run 0059. A
// whitespace-only name is cleared to NULL; an over-long name stops the
// migration with a clear error instead of being truncated.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";

const MIGRATION = "0059_users_display_name_check";
const folders: string[] = [];

/** A copy of ./drizzle with every migration up to (not including) 0059. */
function folderBefore0059(): string {
  const folder = mkdtempSync(join(tmpdir(), "display-name-"));
  folders.push(folder);
  cpSync("./drizzle", folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; idx: number }[];
  };
  const cut = journal.entries.find((e) => e.tag === MIGRATION)?.idx;
  if (cut === undefined) throw new Error(`${MIGRATION} missing from the journal`);
  for (const e of journal.entries.filter((e) => e.idx >= cut)) rmSync(join(folder, `${e.tag}.sql`));
  journal.entries = journal.entries.filter((e) => e.idx < cut);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

async function dbBefore0059() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folderBefore0059() });
  return { client, db };
}

afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

describe("migration 0059 users_display_name_check", () => {
  it("clears whitespace-only names, keeps real ones, then enforces the check", async () => {
    const { client, db } = await dbBefore0059();
    await client.query(
      `INSERT INTO users (email, display_name) VALUES
         ('blank@t', ''), ('spaces@t', '   '), ('tabs@t', E'\\t\\n'),
         ('real@t', 'Ada'), ('none@t', NULL), ('forty@t', $1)`,
      ["a".repeat(40)],
    );

    await migrate(db, { migrationsFolder: "./drizzle" });

    const { rows } = await client.query<{ email: string; display_name: string | null }>(
      `SELECT email, display_name FROM users ORDER BY email`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.email, r.display_name]))).toEqual({
      "blank@t": null,
      "forty@t": "a".repeat(40),
      "none@t": null,
      "real@t": "Ada",
      "spaces@t": null,
      "tabs@t": null,
    });
    await expect(
      client.query(`INSERT INTO users (email, display_name) VALUES ('x@t', ' ')`),
    ).rejects.toThrow(/users_display_name_check/);
  });

  it("refuses to run, and truncates nothing, when a name is over 40 characters", async () => {
    const { client, db } = await dbBefore0059();
    const long = "b".repeat(41);
    await client.query(`INSERT INTO users (email, display_name) VALUES ('long@t', $1)`, [long]);

    await expect(migrate(db, { migrationsFolder: "./drizzle" })).rejects.toThrow(
      /longer than 40 characters/,
    );

    const { rows } = await client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE email = 'long@t'`,
    );
    expect(rows[0]?.display_name).toBe(long);
  });
});
