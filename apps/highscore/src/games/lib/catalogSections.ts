// Grouping for the Games-home catalog views ("Friends' games" / "All games"):
// one section per game type, in the registry's category order, games inside
// a section keeping the order the server ranked them in (most played first).
// Empty categories are dropped; `other` (user-added URLs the registry doesn't
// know) always lands last because the registry lists it last.

import {
  GAME_CATEGORIES,
  type GameCategory,
  gameCategoryForKey,
  gameCategoryLabel,
} from "@workshop/shared/gameRegistry";
import type { CatalogGame, DiscoveryGame } from "@workshop/shared/games";

/** One row of a catalog view — what both the friends feed and the all-games feed reduce to. */
export interface CatalogRow {
  game: CatalogGame["game"];
  /** "Sam & Alex play" / "12 players · Sam plays" — built by the caller. */
  subtitle: string | null;
  inMyGames: boolean;
}

export interface CatalogSection {
  category: GameCategory;
  title: string;
  data: CatalogRow[];
}

export function groupCatalogRows(rows: CatalogRow[]): CatalogSection[] {
  const byCategory = new Map<GameCategory, CatalogRow[]>();
  for (const row of rows) {
    const category = gameCategoryForKey(row.game.gameKey);
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  }
  return GAME_CATEGORIES.flatMap(({ key }) => {
    const data = byCategory.get(key);
    return data ? [{ category: key, title: gameCategoryLabel(key), data }] : [];
  });
}

/** "Sam plays" / "Sam & Alex play" / "Sam, Alex +2 play"; null for nobody. */
export function friendsPlayLine(friends: { displayName: string | null }[]): string | null {
  const names = friends.map((f) => f.displayName?.trim() || "Someone");
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} plays`;
  if (names.length === 2) return `${names[0]} & ${names[1]} play`;
  return `${names[0]}, ${names[1]} +${names.length - 2} play`;
}

/** "12 players" / "1 player" / "No players yet". */
export function playerCountLine(count: number): string {
  if (count === 0) return "No players yet";
  return count === 1 ? "1 player" : `${count} players`;
}

export function friendsFeedRows(games: DiscoveryGame[]): CatalogRow[] {
  return games.map((dg) => ({
    game: dg.game,
    subtitle: friendsPlayLine(dg.friends) ?? "A friend plays this",
    inMyGames: dg.inMyGames,
  }));
}

export function allGamesRows(games: CatalogGame[]): CatalogRow[] {
  return games.map((cg) => {
    const friendLine = friendsPlayLine(cg.friends);
    const count = playerCountLine(cg.playerCount);
    return {
      game: cg.game,
      subtitle: friendLine ? `${count} · ${friendLine}` : count,
      inMyGames: cg.inMyGames,
    };
  });
}
