// Backend adapter over the shared game registry (@workshop/shared/gameRegistry)
// plus the games-catalog DB helpers (find-or-create, legacy item mapping).
//
// Score parsing is spec-driven (see @workshop/shared/scoreParsing): registry
// games carry their spec in code, user-taught games store one in
// `games.score_spec`, and legacy items keep a stored-rule string on
// `items.score_regex` (bare regex / `count:` / `spec:` generations all decode).

import {
  type GameDefinition,
  gameDefinitionForKey,
  identifyGame,
} from "@workshop/shared/gameRegistry";
import { normalizeGameUrl } from "@workshop/shared/games";
import {
  evaluateScoreSpec,
  parseFirstNumber,
  type ScoreSpec,
  safeParseScoreSpec,
  specFromStoredRule,
  storedRuleFromSpec,
} from "@workshop/shared/scoreParsing";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, games, items } from "../db/schema.js";
import { googleFaviconUrl } from "./link-preview/image-validation.js";
import type { DbClient } from "./sql.js";

type ScoreDirection = "asc" | "desc";

/**
 * Display metadata for a games row being created. `title` only applies to
 * non-catalog games (catalog titles are canonical); `iconUrl` applies to both.
 */
export interface GameMetadataHints {
  title?: string | null;
  iconUrl?: string | null;
}

/**
 * Lazy hints — only awaited when a new row is actually inserted, so callers
 * can wire a network fetch (link preview) without paying for it on the
 * already-in-catalog path.
 */
type GameMetadataHintsProvider = () => Promise<GameMetadataHints | null>;

const MAX_GAME_TITLE_LENGTH = 80;

/**
 * Distill a page `<title>` into a card-sized game name: collapse whitespace,
 * and when the title is long, keep the segment before the first separator
 * ("Wordle — The New York Times" → "Wordle"). Short titles pass through
 * untouched so legit hyphenated names survive.
 */
export function cleanGameTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let title = raw.replace(/\s+/g, " ").trim();
  if (title.length === 0) return null;
  if (title.length > 40) {
    const head = title.split(/\s*[|·—–]\s*|\s+-\s+/)[0]?.trim();
    if (head && head.length >= 3) title = head;
  }
  if (title.length > MAX_GAME_TITLE_LENGTH) {
    title = `${title.slice(0, MAX_GAME_TITLE_LENGTH - 1).trimEnd()}…`;
  }
  return title;
}

/**
 * Last-resort thumbnail for a catalog row — Google's s2 favicon for the host
 * (always returns *something*; the generic globe for unknown hosts). Kept in
 * sync with the SQL fallback in migration 0028.
 */
export function defaultGameIconUrl(normalizedUrl: string): string {
  const host = normalizedUrl.split("/")[0]?.split(":")[0] ?? normalizedUrl;
  return googleFaviconUrl(host);
}

export function normalizeScoreDirection(value: string | null | undefined): ScoreDirection {
  return value === "asc" ? "asc" : "desc";
}

/** Registry definition for a catalog game_key (null for unknown games). */
export function catalogEntryForKey(gameKey: string | null): GameDefinition | null {
  const def = gameDefinitionForKey(gameKey);
  return def?.catalog ? def : null;
}

/**
 * The parser resolution chain for a games-table row:
 * registry spec (by game_key) → user-taught `games.score_spec` jsonb → null.
 */
export function specForGame(game: {
  gameKey: string | null;
  scoreSpec?: unknown;
}): ScoreSpec | null {
  const def = catalogEntryForKey(game.gameKey);
  if (def?.spec) return def.spec;
  return safeParseScoreSpec(game.scoreSpec ?? null);
}

/**
 * Pull a numeric score out of pasted share text. With a spec, the spec
 * decides — including "this share has no result" (null). Without one, fall
 * back to "first number anywhere" so legacy/custom games keep their historical
 * behavior. A spec whose rules are all malformed is treated like no spec
 * (score posting must not 500 on a bad stored pattern).
 */
export function parseScoreValue(raw: string, spec: ScoreSpec | null): number | null {
  if (spec) {
    const result = evaluateScoreSpec(spec, raw);
    if (result.hadValidRule) return result.value;
  }
  return parseFirstNumber(raw);
}

/**
 * Find-or-create a catalog row for `normalizedUrl`. Known games collapse onto
 * their canonical row even when the pasted variant uses a different path/host
 * form; unknown URLs dedup on the normalized form and get a hostname title
 * unless `hints` carries a better one (e.g. from a link preview). Every new
 * row gets an `iconUrl` — the hinted favicon or the Google s2 fallback.
 */
export async function findOrCreateGame(
  inputUrl: string,
  normalizedUrl = normalizeGameUrl(inputUrl),
  db: DbClient = getDb(),
  hints?: GameMetadataHints | GameMetadataHintsProvider,
): Promise<DbGame> {
  if (!normalizedUrl) throw new Error("game URL did not normalize");

  const lookup = async (key: string): Promise<DbGame | null> => {
    const [row] = await db.select().from(games).where(eq(games.normalizedUrl, key)).limit(1);
    return row ?? null;
  };

  const existing = await lookup(normalizedUrl);
  if (existing) return existing;

  const detected = identifyGame([inputUrl], { catalogOnly: true });
  const canonicalKey = detected ? normalizeGameUrl(detected.canonicalUrl) : null;
  if (detected && canonicalKey) {
    const canonical = await lookup(canonicalKey);
    if (canonical) return canonical;
  }

  // Only now (an insert is actually happening) pay for lazy hints.
  const resolvedHints =
    (typeof hints === "function" ? await hints().catch(() => null) : hints) ?? {};
  const iconHint = resolvedHints.iconUrl ?? null;

  const values =
    detected && canonicalKey
      ? {
          normalizedUrl: canonicalKey,
          url: detected.canonicalUrl,
          title: detected.title,
          iconUrl: iconHint ?? defaultGameIconUrl(canonicalKey),
          gameKey: detected.key,
          scoreDirection: detected.scoreDirection,
        }
      : {
          normalizedUrl,
          url: `https://${normalizedUrl}`,
          title:
            cleanGameTitle(resolvedHints.title) ?? normalizedUrl.split("/")[0] ?? normalizedUrl,
          iconUrl: iconHint ?? defaultGameIconUrl(normalizedUrl),
          gameKey: null,
          scoreDirection: "desc" as const,
        };

  const [inserted] = await db.insert(games).values(values).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const raced = await lookup(values.normalizedUrl);
  if (!raced) throw new Error("game find-or-create failed");
  return raced;
}

interface LeaderboardItemGameFields {
  itemId: string;
  gameId: string | null;
  scoreRegex: string | null;
  scoreDirection: string | null;
  title: string;
  url: string | null;
  siteName: string | null;
  sourceId: string | null;
}

interface LeaderboardGameMapping {
  game: DbGame;
  /** Resolved parser for this item's game (registry → user spec → item rule). */
  spec: ScoreSpec | null;
  scoreDirection: ScoreDirection;
}

/**
 * Resolve a legacy leaderboard item to the canonical Games catalog row. Known
 * games use the shared registry; unknown URL-backed items can still map to a
 * catalog row, but keep any item-local parser metadata.
 */
export async function ensureLeaderboardItemGame(
  fields: LeaderboardItemGameFields,
  db: DbClient = getDb(),
): Promise<LeaderboardGameMapping | null> {
  if (fields.gameId) {
    const [game] = await db.select().from(games).where(eq(games.id, fields.gameId)).limit(1);
    if (game) {
      const catalog = catalogEntryForKey(game.gameKey);
      return {
        game,
        spec: specForGame(game) ?? specFromStoredRule(fields.scoreRegex),
        scoreDirection: catalog?.scoreDirection ?? normalizeScoreDirection(game.scoreDirection),
      };
    }
  }

  const detected = identifyGame([fields.title, fields.url, fields.siteName, fields.sourceId], {
    catalogOnly: true,
  });
  const inputUrl = detected?.canonicalUrl ?? fields.url;
  if (!inputUrl) return null;
  const normalized = normalizeGameUrl(inputUrl);
  if (!normalized) return null;

  // The item's title is the best name we have for a non-catalog game; no
  // network fetch here so the score-post path stays fast.
  const game = await findOrCreateGame(inputUrl, normalized, db, { title: fields.title });
  const catalog = detected ?? catalogEntryForKey(game.gameKey);
  const spec =
    catalog?.spec ?? safeParseScoreSpec(game.scoreSpec) ?? specFromStoredRule(fields.scoreRegex);
  const nextScoreDirection =
    catalog?.scoreDirection ??
    normalizeScoreDirection(fields.scoreDirection ?? game.scoreDirection);

  const patch: { gameId: string; scoreRegex?: string; scoreDirection?: string } = {
    gameId: game.id,
  };
  if (catalog?.spec) {
    patch.scoreRegex = storedRuleFromSpec(catalog.spec);
    patch.scoreDirection = catalog.scoreDirection;
  }
  await db.update(items).set(patch).where(eq(items.id, fields.itemId));

  return {
    game,
    spec,
    scoreDirection: nextScoreDirection,
  };
}
