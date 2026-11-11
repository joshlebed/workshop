// Response-shape mappers shared by the Games and Friends routers (one
// definition — these used to be "kept local" copies that drifted).

import { gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import type { Game, GameScoreUnit } from "@workshop/shared/games";
import { safeParseScoreSpec } from "@workshop/shared/scoreParsing";
import { safeParseSummarySpec } from "@workshop/shared/summarySpec";
import type { DbGame } from "../db/schema.js";
import { toIsoString } from "./dates.js";
import { normalizeScoreDirection } from "./gameCatalog.js";

/** Puzzle-day key, UTC. Clients may pass `?period=` to pin their local day. */
export function todayPeriodKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The game's score unit: the taught column, else what the registry says. */
export function gameScoreUnit(row: Pick<DbGame, "scoreUnit" | "gameKey">): GameScoreUnit | null {
  if (row.scoreUnit === "seconds") return "seconds";
  return gameDefinitionForKey(row.gameKey)?.scoreUnit ?? null;
}

export function toGameShape(row: DbGame): Game {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    title: row.title,
    iconUrl: row.iconUrl,
    gameKey: row.gameKey,
    scoreDirection: normalizeScoreDirection(row.scoreDirection),
    scoreUnit: gameScoreUnit(row),
    // Validated on the way out: the columns are jsonb written through the
    // score-spec endpoint, but old/hand-edited rows must not crash the shape.
    scoreSpec: safeParseScoreSpec(row.scoreSpec),
    summarySpec: safeParseSummarySpec(row.summarySpec),
    hasParser: row.parseCode !== null,
    hasFormatter: row.formatCode !== null,
    createdAt: toIsoString(row.createdAt),
  };
}
