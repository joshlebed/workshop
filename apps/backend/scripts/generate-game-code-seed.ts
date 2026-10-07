// Rewrites the seed migration from src/lib/gameCode/{builtin,specCode}.ts.
//
//   pnpm --filter @workshop/backend exec tsx scripts/generate-game-code-seed.ts
//
// Only for use BEFORE the migration has shipped. After that it is history —
// change a game's code with `admin:game-code`, or write a new migration.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildGameCodeSeedSql } from "../src/lib/gameCode/seedSql.js";

const SEED_MIGRATION = "0043_seed_game_code.sql";

const target = fileURLToPath(new URL(`../drizzle/${SEED_MIGRATION}`, import.meta.url));
writeFileSync(target, buildGameCodeSeedSql());
console.log(`wrote ${target}`);
