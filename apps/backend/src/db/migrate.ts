import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getConfig } from "../lib/config.js";

async function main() {
  const { databaseUrl, isLocal } = getConfig();
  const client = postgres(databaseUrl, {
    ssl: isLocal ? false : "require",
    max: 1,
  });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error("migration failed", err);
  process.exit(1);
});
