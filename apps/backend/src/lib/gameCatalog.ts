import { normalizeGameUrl } from "@workshop/shared/games";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, games, items } from "../db/schema.js";
import { GAME_REGEX_CATALOG, matchGameScoreRegex, SCORE_COUNT_PREFIX } from "./gameScoreRegex.js";
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

interface GameCatalogEntry {
  key: string;
  title: string;
  canonicalUrl: string;
  scoreRegex: string;
  scoreDirection: ScoreDirection;
}

export function normalizeScoreDirection(value: string | null | undefined): ScoreDirection {
  return value === "asc" ? "asc" : "desc";
}

export function catalogEntryForKey(gameKey: string | null): GameCatalogEntry | null {
  if (!gameKey) return null;
  return GAME_REGEX_CATALOG.find((g) => g.key === gameKey) ?? null;
}

/**
 * Pull a numeric score out of pasted share text. `count:<pattern>` counts
 * global matches; a capture-group pattern reads group 1; no pattern falls
 * back to "first number anywhere" for legacy/custom games.
 */
export function parseScoreValue(raw: string, pattern: string | null = null): number | null {
  if (pattern && pattern.length > 0) {
    if (pattern.startsWith(SCORE_COUNT_PREFIX)) {
      try {
        const re = new RegExp(pattern.slice(SCORE_COUNT_PREFIX.length), "gu");
        return (raw.match(re) ?? []).length;
      } catch {
        // Bad count pattern - fall through to the first-number fallback.
      }
    } else {
      try {
        const re = new RegExp(pattern, "i");
        const match = raw.match(re);
        if (match) {
          const captured = match[1] ?? match[0];
          const n = Number(captured);
          if (Number.isFinite(n)) return n;
        }
        return null;
      } catch {
        // Bad regex - fall through so score posting does not 500.
      }
    }
  }
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
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

  const detected = matchGameScoreRegex({ url: inputUrl });
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
  scoreRegex: string | null;
  scoreDirection: ScoreDirection;
}

/**
 * Resolve a legacy leaderboard item to the canonical Games catalog row. Known
 * games use the shared regex catalog; unknown URL-backed items can still map
 * to a catalog row, but keep any item-local parser metadata.
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
        scoreRegex: catalog?.scoreRegex ?? fields.scoreRegex,
        scoreDirection: catalog?.scoreDirection ?? normalizeScoreDirection(game.scoreDirection),
      };
    }
  }

  const detected = matchGameScoreRegex(fields);
  const inputUrl = detected?.canonicalUrl ?? fields.url;
  if (!inputUrl) return null;
  const normalized = normalizeGameUrl(inputUrl);
  if (!normalized) return null;

  // The item's title is the best name we have for a non-catalog game; no
  // network fetch here so the score-post path stays fast.
  const game = await findOrCreateGame(inputUrl, normalized, db, { title: fields.title });
  const catalog = detected ?? catalogEntryForKey(game.gameKey);
  const nextScoreRegex = catalog?.scoreRegex ?? fields.scoreRegex;
  const nextScoreDirection =
    catalog?.scoreDirection ??
    normalizeScoreDirection(fields.scoreDirection ?? game.scoreDirection);

  const patch: { gameId: string; scoreRegex?: string; scoreDirection?: string } = {
    gameId: game.id,
  };
  if (catalog) {
    patch.scoreRegex = catalog.scoreRegex;
    patch.scoreDirection = catalog.scoreDirection;
  }
  await db.update(items).set(patch).where(eq(items.id, fields.itemId));

  return {
    game,
    scoreRegex: nextScoreRegex,
    scoreDirection: nextScoreDirection,
  };
}
