// Grouping + ordering for the Add-game screen's two tabs. Both reduce to one
// row shape (`CatalogRow`) carrying a `weight`: how many of *your friends*
// play the game (Friends tab) or how many people on the platform do (Catalog
// tab). Within a game type, rows sort by weight (most played first); the
// game types themselves sort by their most-played game, so the section with
// the game most of your friends play leads. Ties fall back to the registry's
// category order, then title. Empty categories are dropped.

import {
  GAME_CATEGORIES,
  type GameCategory,
  gameCategoryFor,
  gameCategoryLabel,
} from "@workshop/shared/gameRegistry";
import type { CatalogGame, DiscoveryGame } from "@workshop/shared/games";

export interface CatalogRow {
  game: CatalogGame["game"];
  /** "3 friends · Sam, Alex +1" / "12 players" — built by the row builders below. */
  subtitle: string | null;
  /** Popularity in the tab's population: friend count or platform player count. */
  weight: number;
  inMyGames: boolean;
}

export interface CatalogSection {
  category: GameCategory;
  title: string;
  data: CatalogRow[];
}

const CATEGORY_RANK = new Map<GameCategory, number>(GAME_CATEGORIES.map((c, i) => [c.key, i]));

function byWeightThenTitle(a: CatalogRow, b: CatalogRow): number {
  return b.weight - a.weight || a.game.title.localeCompare(b.game.title);
}

export function groupCatalogRows(rows: CatalogRow[]): CatalogSection[] {
  const byCategory = new Map<GameCategory, CatalogRow[]>();
  for (const row of rows) {
    const category = gameCategoryFor(row.game);
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  }
  const sections: CatalogSection[] = [];
  for (const [category, data] of byCategory) {
    data.sort(byWeightThenTitle);
    sections.push({ category, title: gameCategoryLabel(category), data });
  }
  // Sorted copies: the leading row of each section is its max weight.
  return sections.sort(
    (a, b) =>
      (b.data[0]?.weight ?? 0) - (a.data[0]?.weight ?? 0) ||
      (CATEGORY_RANK.get(a.category) ?? 0) - (CATEGORY_RANK.get(b.category) ?? 0),
  );
}

/** "Sam" / "Sam & Alex" / "Sam, Alex +2"; null for nobody. */
export function friendNamesLine(friends: { displayName: string | null }[]): string | null {
  const names = friends.map((f) => f.displayName?.trim() || "Someone");
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** "Sam plays" / "Sam & Alex play" / "Sam, Alex +2 play"; null for nobody. */
export function friendsPlayLine(friends: { displayName: string | null }[]): string | null {
  const names = friendNamesLine(friends);
  if (names === null) return null;
  return `${names} ${friends.length === 1 ? "plays" : "play"}`;
}

/** "12 players" / "1 player" / "No players yet". */
export function playerCountLine(count: number): string {
  if (count === 0) return "No players yet";
  return count === 1 ? "1 player" : `${count} players`;
}

/** Friends tab rows: "3 friends · Sam, Alex +1". */
export function friendsFeedRows(games: DiscoveryGame[]): CatalogRow[] {
  return games.map((dg) => {
    const n = dg.friends.length;
    const names = friendNamesLine(dg.friends);
    return {
      game: dg.game,
      subtitle: names ? `${n} ${n === 1 ? "friend" : "friends"} · ${names}` : null,
      weight: n,
      inMyGames: dg.inMyGames,
    };
  });
}

/** Catalog tab rows: a count only, never a name. */
export function catalogRows(games: CatalogGame[]): CatalogRow[] {
  return games.map((cg) => ({
    game: cg.game,
    subtitle: playerCountLine(cg.playerCount),
    weight: cg.playerCount,
    inMyGames: cg.inMyGames,
  }));
}
