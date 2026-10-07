// Rewrites the game-code seed migrations from src/lib/gameCode/{builtin,specCode}.ts.
//
//   pnpm --filter @workshop/backend exec tsx scripts/generate-game-code-seed.ts
//
// Only for use BEFORE a migration has shipped. After that it is history —
// change a game's code with `admin:game-code`, or write a new migration.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGameCodeSeedSql, buildTaughtSpecCatchUpSql } from "../src/lib/gameCode/seedSql.js";

const MIGRATIONS: Array<[file: string, build: () => string]> = [
  ["0043_seed_game_code.sql", buildGameCodeSeedSql],
  ["0044_convert_taught_specs_to_code.sql", buildTaughtSpecCatchUpSql],
];

for (const [file, build] of MIGRATIONS) {
  const target = fileURLToPath(new URL(`../drizzle/${file}`, import.meta.url));
  writeFileSync(target, build());
  console.log(`wrote ${target}`);
}
