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

/** One friend who reacted to a score (identity stays inside the friend graph). */
export interface ScoreReactionReactor {
  userId: string;
  displayName: string | null;
}

/**
 * One emoji's worth of reactions on a single score, aggregated for display.
 * Reactions are one-per-reactor (tapback model), so a given reactor appears in
 * at most one summary per score, and `viewerReacted` flags the summary holding
 * the viewer's own current reaction.
 */
export interface ScoreReactionSummary {
  emoji: string;
  count: number;
  reactors: ScoreReactionReactor[];
  viewerReacted: boolean;
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
  /**
   * Emoji reactions on this score from people inside the viewer's friend
   * graph (G2c). Always present; empty when nobody has reacted.
   */
  reactions: ScoreReactionSummary[];
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
 * `PUT` / `DELETE /v1/games/:id/reactions/:periodKey/:scoreUserId` — set,
 * replace, or clear the viewer's emoji reaction on a friend's score. Returns
 * the affected score's full reaction summary (viewer-relative) so the client
 * can reconcile without a refetch.
 */
export interface SetScoreReactionResponse {
  reactions: ScoreReactionSummary[];
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
  /**
   * Whether the viewer already has this game in My Games. Always `false` in the
   * default feed (which omits games you already added); only ever `true` in the
   * `?includeOwned=1` feed that powers the + add-game sheet, where owned games
   * stay in the ranked list — rendered non-addable — so the viewer sees the
   * full "what my friends play" picture, not just the addable remainder.
   */
  inMyGames: boolean;
}

export interface GameDiscoveryResponse {
  games: DiscoveryGame[];
  /**
   * Total number of games the scoped friend has added — set only for the
   * `?friend=<userId>` form, omitted for the all-friends feed. Lets the UI
   * tell "friend has no games" apart from "friend has games but you already
   * have them all" (both yield an empty `games` list, since the default feed
   * filters out games you've already added — the `?includeOwned=1` feed keeps
   * them).
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

/**
 * The quick-reaction bar shown first in the picker (G2c). The full OS emoji
 * keyboard is reachable behind a "more" affordance, so this is just the
 * fast-path set, not an allowlist — `isReactionEmoji` is the real gate.
 */
export const REACTION_QUICK_EMOJIS = ["👍", "🔥", "😂", "😮", "👏", "🎉"] as const;

// A reaction must be a short emoji string. We allow ZWJ sequences (👨‍👩‍👧),
// skin-tone modifiers (👍🏽), regional-indicator flags (🇺🇸), keycaps (5️⃣)
// and variation selectors, but require at least one pictographic / flag / keycap
// codepoint so the field can't be smuggled plain text or bare digits
// (Emoji_Component alone matches "5"; the enclosing-keycap mark U+20E3 is what
// separates the emoji "5️⃣" from the digit "5").
const REACTION_EMOJI_ALLOWED =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|\u200d|\ufe0f)+$/u;
const REACTION_EMOJI_REQUIRED = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u;

/** True when `value` is a single, short emoji usable as a score reaction. */
export function isReactionEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return false;
  return REACTION_EMOJI_ALLOWED.test(trimmed) && REACTION_EMOJI_REQUIRED.test(trimmed);
}
