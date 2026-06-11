// Games surface (spec §3) — shared types + the URL normalizer that dedupes
// the global game catalog. Pure runtime module exported via the `./games`
// subpath (like `./constants`): Metro can't resolve the barrel's `.js`
// re-exports, so the client must import this file directly —
// `import { normalizeGameUrl } from "@workshop/shared/games"`.

import type { ScoreSpec } from "./scoreParsing.js";

export type GameScoreDirection = "asc" | "desc";

/** A row in the global game catalog, deduped by `normalizedUrl`. */
export interface Game {
  id: string;
  /** Canonical display/link URL (original scheme preserved). */
  url: string;
  /** Dedup key — see `normalizeGameUrl`. */
  normalizedUrl: string;
  title: string;
  iconUrl: string | null;
  /** Key into the shared game registry; null for unknown games. */
  gameKey: string | null;
  scoreDirection: GameScoreDirection;
  /**
   * User-taught parser spec (games the registry doesn't know). Null when
   * unset — and always null for registry games, whose specs live in code.
   */
  scoreSpec: ScoreSpec | null;
  createdAt: string;
}

/** Per-user membership of a game in "My Games" (ordered selection). */
export interface UserGame {
  gameId: string;
  position: number | null;
  addedAt: string;
}

/** One posted score: `(gameId, userId, periodKey)` is the identity. */
export interface GameScore {
  gameId: string;
  userId: string;
  periodKey: string;
  scoreValue: number | null;
  scoreRaw: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of a game's standings for a period. Covers the viewer and their
 * friends (G2a); the entry shape is the same either way.
 */
export interface GameStandingsEntry {
  userId: string;
  displayName: string | null;
  scoreRaw: string | null;
  scoreValue: number | null;
  /** Standard competition rank (1, 2, 2, 4); null when no numeric score. */
  rank: number | null;
  updatedAt: string | null;
}

/** A period's standings block for one game — drives the leaderboard card. */
export interface GameStandings {
  periodKey: string;
  entries: GameStandingsEntry[];
  viewerHasPlayed: boolean;
}

/** `GET /v1/games` — one element per game in My Games, in my order. */
export interface MyGame extends UserGame {
  game: Game;
  standings: GameStandings;
}

export interface GamesResponse {
  periodKey: string;
  games: MyGame[];
}

/** `GET /v1/games/:id/leaderboard?period=` */
export interface GameLeaderboardResponse {
  gameId: string;
  periodKey: string;
  entries: GameStandingsEntry[];
}

/** `POST /v1/games` / `PUT /v1/games/:id/scores` responses. */
export interface AddGameResponse {
  game: Game;
  userGame: UserGame;
}

export interface UpsertGameScoreResponse {
  score: GameScore;
}

/** `PUT /v1/games/:id/score-spec` — teach a non-registry game its parser. */
export interface SetGameScoreSpecResponse {
  game: Game;
}

/**
 * `GET /v1/games/discovery` (G2a) — games my friends play that I haven't
 * added, each tagged with which friends play it. Powers the + sheet
 * suggestions, the friends-but-no-games empty state, and the post-accept
 * picker (UI in G3).
 */
export interface DiscoveryFriend {
  userId: string;
  displayName: string | null;
}

export interface DiscoveryGame {
  game: Game;
  friends: DiscoveryFriend[];
}

export interface GameDiscoveryResponse {
  games: DiscoveryGame[];
  /**
   * Total number of games the scoped friend has added — set only for the
   * `?friend=<userId>` form, omitted for the all-friends feed. Lets the UI
   * tell "friend has no games" apart from "friend has games but you already
   * have them all" (both yield an empty `games` list, since discovery filters
   * out games you've already added).
   */
  friendGameCount?: number;
}

/**
 * Normalize a game URL into the global catalog's dedup key: lowercase host,
 * strip `www.`, drop query + fragment (the `dailytens.com/?ref=<id>` junk),
 * trim trailing slash(es), keep the path (and any non-default port). The
 * scheme is dropped so http/https variants collapse. Accepts scheme-less
 * input ("wordle.com"). Returns null when the input isn't a usable
 * http(s) URL with a dotted host.
 */
export function normalizeGameUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  // Anything that already carries a scheme (mailto:, ftp:, https:) is parsed
  // as-is so non-http schemes get rejected below; the `(?![0-9])` keeps a
  // scheme-less "host:8080/path" from being mistaken for one.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?![0-9])/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  let host = url.host.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  // Require a dotted hostname — every real game site has a TLD, and this
  // rejects pasted non-URLs ("wordle") that the URL parser happily accepts.
  if (!host.includes(".")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}
