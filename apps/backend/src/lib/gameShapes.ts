// Response-shape mappers shared by the Games and Friends routers (one
// definition — these used to be "kept local" copies that drifted).

import { gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import type { Game, GameScoreUnit } from "@workshop/shared/games";
import { safeParseScoreSpec } from "@workshop/shared/scoreParsing";
import { safeParseSummarySpec } from "@workshop/shared/summarySpec";
import { sql } from "drizzle-orm";
import { type DbGame, games } from "../db/schema.js";
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

/**
 * The `games` columns a response needs, for read paths that only shape a game
 * for the client. A game's parser and formatter source (`parse_code`,
 * `format_code`, ~1 KB a row) never reaches a client, which only learns
 * whether each exists, so it is not read out of the database either: selecting
 * whole rows made the Games home pull about four times what it returned.
 * Paths that run the code still select the whole row.
 */
export const gameShapeColumns = {
  id: games.id,
  url: games.url,
  normalizedUrl: games.normalizedUrl,
  title: games.title,
  iconUrl: games.iconUrl,
  gameKey: games.gameKey,
  scoreDirection: games.scoreDirection,
  scoreUnit: games.scoreUnit,
  scoreSpec: games.scoreSpec,
  summarySpec: games.summarySpec,
  hasParser: sql<boolean>`${games.parseCode} is not null`,
  hasFormatter: sql<boolean>`${games.formatCode} is not null`,
  createdAt: games.createdAt,
};

/** A row selected with `gameShapeColumns`. */
export type GameShapeRow = Pick<
  DbGame,
  | "id"
  | "url"
  | "normalizedUrl"
  | "title"
  | "iconUrl"
  | "gameKey"
  | "scoreDirection"
  | "scoreUnit"
  | "scoreSpec"
  | "summarySpec"
  | "createdAt"
> & { hasParser: boolean; hasFormatter: boolean };

export function toGameShape(row: DbGame | GameShapeRow): Game {
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
    hasParser: "hasParser" in row ? row.hasParser : row.parseCode !== null,
    hasFormatter: "hasFormatter" in row ? row.hasFormatter : row.formatCode !== null,
    createdAt: toIsoString(row.createdAt),
  };
}
