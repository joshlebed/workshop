// Games surface (spec §3) — shared types + the URL normalizer that dedupes
// the global game catalog. Pure runtime module exported via the `./games`
// subpath (like `./constants`): Metro can't resolve the barrel's `.js`
// re-exports, so the client must import this file directly —
// `import { normalizeGameUrl } from "@workshop/shared/games"`.

import type { ScoreFeature, ScoreFeatureRole, ScorePick } from "./scoreCandidates.js";
import type { ScoreSpec } from "./scoreParsing.js";
import type { SummarySpec } from "./summarySpec.js";

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
  /**
   * User-taught recap formatter (the display-side twin of `scoreSpec`) —
   * which share lines the leaderboard rows / clipboard recaps keep. Null when
   * unset (full-text fallback); always null for registry games, whose
   * `formatShareBody` formatters live in code.
   */
  summarySpec: SummarySpec | null;
  /**
   * The game has stored parse code — from the registry seed, a taught spec,
   * an operator, or teach v2. A client must not offer the old first-teach
   * flow for such a game even when `scoreSpec` is null: the server refuses a
   * non-admin teach over existing code. Absent from older servers.
   */
  hasParser?: boolean;
  /**
   * The game has stored format code, so a row's `scoreSummary` is a recap
   * written for display and carries the score itself. Without one the summary
   * is just the cleaned share text — the client then says "Score: N" on the
   * row, for every player alike. Absent from older servers.
   */
  hasFormatter?: boolean;
  createdAt: string;
}

/** Per-user membership of a game in "My Games" (ordered selection). */
export interface UserGame {
  gameId: string;
  position: number | null;
  addedAt: string;
}

/**
 * What a game's stored parse code made of a score's text: a number
 * (`scoreValue`), a real share with no score — a loss (`no_result`), or text
 * the code could not read (`failed`; the row is unranked).
 */
export type ScoreParseStatus = "score" | "no_result" | "failed";

/**
 * The server-computed reading of a score. Present only on scores the server
 * parsed with the game's stored code; absent on scores the legacy parser
 * wrote, where a null `scoreValue` can mean a loss or an unread share and
 * the client still formats `scoreRaw` itself.
 */
export interface ScoreCodeFields {
  parseStatus?: ScoreParseStatus;
  /**
   * The text to show for this score — the game's formatter output, or the
   * cleaned raw text when it has none. Null = nothing worth showing (a
   * URL-only share). Only meaningful when `parseStatus` is present.
   */
  scoreSummary?: string | null;
}

/** Where a score's value came from: the game's parser, or the player's own pick. */
export type ScoreSource = "parsed" | "picked";

/**
 * Teach v2's additions to a score, present only for a caller it is on for.
 * `parseStatus: "failed"` is what the product calls *unread*.
 */
export interface ScorePickFields {
  scoreSource?: ScoreSource;
  /** The player picked this score and the game's parser reads the text differently. */
  adjusted?: boolean;
}

/** One posted score: `(gameId, userId, periodKey)` is the identity. */
export interface GameScore extends ScoreCodeFields, ScorePickFields {
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
export interface GameStandingsEntry extends ScoreCodeFields, ScorePickFields {
  userId: string;
  displayName: string | null;
  scoreRaw: string | null;
  scoreValue: number | null;
  /**
   * Standard competition rank (1, 2, 2, 4); null when no numeric score. With
   * teach v2 on for the viewer, a `no_result` row ranks in last place and only
   * a `failed` (unread) row has no rank.
   */
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
  /**
   * The viewer's current consecutive-day play streak for this game, as of
   * `periodKey` (see `computeGameStreak`). 0 when the run has lapsed (last play
   * older than the day before `periodKey`) or they've never played. Drives the
   * Games-home streak flame next to the title — a "play today to keep it" CTA.
   */
  viewerStreak: number;
}

/** `GET /v1/games` — one element per game in My Games, in my order. */
export interface MyGame extends UserGame {
  game: Game;
  standings: GameStandings;
}

/**
 * Which optional Games features the server has on for this caller. A client
 * reads these before using a feature's endpoints, so a caller without one
 * never requests it (and never sees its 404).
 */
export interface GamesCapabilities {
  /** `POST /v1/games/recognize` answers for this caller. */
  recognition: boolean;
  /**
   * The server parses this caller's scores with stored game code, and
   * `POST /v1/games/:id/scores/preview` answers. Absent from servers that
   * predate it — treat that as off.
   */
  codeParsing?: boolean;
  /**
   * Teach v2 is on for this caller: score previews with candidates, the
   * picker, "Fix score" and the teach endpoints. Absent from older servers.
   */
  teach?: boolean;
}

export interface GamesResponse {
  periodKey: string;
  games: MyGame[];
  /** Absent from servers that predate capabilities — treat that as all off. */
  capabilities?: GamesCapabilities;
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
  /** Present when the request carried a pick (teach v2). */
  teach?: ScoreTeachHint;
}

// ---------------------------------------------------------------------------
// Teach v2 — previews, the candidate picker, picks and parser teaching. Every
// endpoint 404s unless `capabilities.teach` is true for the caller.
// ---------------------------------------------------------------------------

/** Why the server refused a score text before running any code. */
export type ScoreInputRejection = "empty" | "url_only" | "title_only" | "too_long" | "future_day";

/** `details` of the 400 a rejected score text gets (`code: "VALIDATION"`). */
export interface ScoreInputRejectedDetails {
  code: "SCORE_INPUT_REJECTED";
  reason: ScoreInputRejection;
}

/** Where a preview was asked from — logged, never changes the answer. */
export type ScoreEntryPoint = "paste" | "share" | "fix";

/** What teach v2 adds to a score preview (`GameScorePreview.teach`). */
export interface ScorePreviewTeach {
  /** How a computed value was derived ("counted 🏆"); null for a literal number. */
  derivation: string | null;
  /** Everything in the text that could be the score, computed by the server. */
  candidates: ScoreFeature[];
  /** Set when the text positively matches a different game. */
  wrongGame: { game: Game; inMyGames: boolean } | null;
  /** Another day the caller already posted this exact text to this game. */
  sameTextPeriodKey: string | null;
  /** False when the game has no parser yet — a pick here is its first teach. */
  hasParser: boolean;
}

/** `POST /v1/games/score-preview` — the share flow: text with no game chosen yet. */
export interface SharePreviewRequest {
  scoreRaw: string;
  periodKey: string;
}

export interface SharePreviewResponse {
  match: RecognizedGame | null;
  /** The preview for the recognised game; null when no game was recognised. */
  preview: GameScorePreview | null;
}

/** `POST /v1/games/:id/scores/candidates` — the picker's role labels (LLM step 1). */
export interface ScoreCandidatesResponse {
  candidates: ScoreFeature[];
  /** Role per candidate id; empty when the labels did not arrive in time. */
  roles: Record<string, ScoreFeatureRole>;
  /** The candidate to pre-select, when the labels named one. */
  scoreId: string | null;
  labelled: boolean;
}

/** `PUT /v1/games/:id/scores` body. `pick` and the rest are teach v2 only. */
export interface UpsertGameScoreRequest {
  periodKey: string;
  scoreRaw: string;
  pick?: ScorePick;
  /** The role label the player overrode ("That looks like the puzzle number. Use it anyway?"). */
  overrodeRole?: ScoreFeatureRole;
  /** Whether the player saw a preview before posting. */
  previewSeen?: boolean;
  /** The wrong-game warning the player answered, if one was shown. */
  wrongGame?: { gameId: string; choice: "here" | "there" };
}

/** `POST /v1/games/:id/scores/:periodKey/pick` — "Fix score" on the caller's own row. */
export interface ApplyScorePickRequest {
  pick: ScorePick;
  overrodeRole?: ScoreFeatureRole;
}

export interface ApplyScorePickResponse {
  score: GameScore;
  teach: ScoreTeachHint;
}

/** What the client should do after a pick was stored. */
export interface ScoreTeachHint {
  /** The pick can teach the game's parser: call `POST /v1/games/:id/parser/teach`. */
  eligible: boolean;
  /** The game has no parser yet, so this teach also sets which way scores rank. */
  needsDirection: boolean;
  suggestedDirection: GameScoreDirection | null;
}

/** `POST /v1/games/:id/parser/teach` — teach from the caller's own picked score. */
export interface TeachParserRequest {
  periodKey: string;
  /** Confirmed by the player on a first teach. */
  scoreDirection?: GameScoreDirection;
}

export type TeachOutcome =
  /** New parser code passed every gate and is live. */
  | "accepted"
  /** A second user agreed: the parser switched over an earlier conflicting pick. */
  | "switched"
  /** Contradicts another player's confirmed pick; the game is flagged, nothing changed. */
  | "conflict"
  /** No code passed the gates; the game is unchanged. */
  | "rejected"
  /** The model was unreachable or slow; the game is unchanged. */
  | "unavailable"
  /** The parser already reads this pick; nothing to do. */
  | "not_needed"
  /** This pick cannot train the parser (the text does not name the game). */
  | "not_eligible";

export interface TeachParserResponse {
  outcome: TeachOutcome;
  game: Game;
  /** The caller's score after the teach (unchanged unless the parser now agrees with it). */
  score: GameScore;
}

/** `PUT /v1/games/:id/score-direction` — from the game's "…" menu. */
export interface SetScoreDirectionRequest {
  scoreDirection: GameScoreDirection;
}

export interface SetScoreDirectionResponse {
  game: Game;
  /** False when the change is held until a second user asks for the same one. */
  applied: boolean;
}

/** `POST /v1/games/:id/scores/preview` — what posting this text would store. */
export interface PreviewGameScoreRequest {
  scoreRaw: string;
  /** Teach v2: the day being posted to (same-text and future-day checks). Defaults to today. */
  periodKey?: string;
  /** Teach v2: where the preview was asked from — logged, never changes the answer. */
  entry?: ScoreEntryPoint;
}

export interface GameScorePreview {
  parseStatus: ScoreParseStatus;
  scoreValue: number | null;
  scoreSummary: string | null;
  /** Present only when teach v2 is on for the caller. */
  teach?: ScorePreviewTeach;
}

export interface PreviewGameScoreResponse {
  preview: GameScorePreview;
}

/** Which evidence recognized a pasted score's game, cheapest first. */
export type GameRecognitionMethod = "url" | "label" | "fingerprint" | "jev";

/** `POST /v1/games/recognize` — which game is this pasted text a score for? */
export interface RecognizeGameRequest {
  text: string;
}

export interface RecognizedGame {
  game: Game;
  /** False when the game is in the catalog but not yet in the caller's My Games. */
  inMyGames: boolean;
  /** 0–1. The server only returns matches it is confident enough to surface. */
  confidence: number;
  method: GameRecognitionMethod;
}

export interface RecognizeGameResponse {
  match: RecognizedGame | null;
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
   * stay in the list — rendered non-addable, sorted after every addable game —
   * so the viewer sees the full "what my friends play" picture, not just the
   * addable remainder.
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
 * `POST /v1/game-share` — my per-(user, day) "play with me" link. Surfaced by
 * the Games-tab copy-scores recap; `url` is the short `/g/:token` form.
 */
export interface GameShareLinkResponse {
  token: string;
  url: string;
}

/**
 * `GET /v1/game-share/:token` — resolve a play link. `user` is the sharer
 * (public — drives the OG card and the not-friends profile redirect). `viewer`
 * is attached **only** for an authenticated request, and drives the `/g/:token`
 * landing's routing: already connected (`isSelf || isFriend`) → Games home;
 * otherwise → the sharer's profile to add them.
 */
export interface GameShareLinkPreview {
  user: { userId: string; displayName: string | null };
  viewer?: { isSelf: boolean; isFriend: boolean };
}

// Meta's outbound-link shims (`l.facebook.com/l.php?u=<target>`): a link
// tapped inside Facebook / Instagram / Messenger is rewritten to one of these,
// with the real destination in the `u` query param.
const LINK_SHIM_HOSTS = new Set([
  "l.facebook.com",
  "lm.facebook.com",
  "l.instagram.com",
  "l.messenger.com",
]);

/**
 * Unwrap a Meta link-shim URL to the destination it redirects to. Returns the
 * input unchanged when it isn't a shim, and null for a shim with no usable
 * target (a bare `l.facebook.com/l.php` is never a game). Without this the
 * normalizer drops the query string and every Facebook-opened game collapses
 * onto one junk `l.facebook.com/l.php` catalog row.
 */
export function unwrapLinkShim(input: string): string | null {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return input;
  }
  if (!LINK_SHIM_HOSTS.has(url.host.toLowerCase())) return input;
  const target = url.searchParams.get("u")?.trim();
  if (!target || !/^https?:\/\//i.test(target)) return null;
  try {
    if (LINK_SHIM_HOSTS.has(new URL(target).host.toLowerCase())) return null;
  } catch {
    return null;
  }
  return target;
}

/**
 * Normalize a game URL into the global catalog's dedup key: lowercase host,
 * strip `www.`, drop query + fragment (the `dailytens.com/?ref=<id>` junk),
 * trim trailing slash(es), keep the path (and any non-default port). The
 * scheme is dropped so http/https variants collapse. Accepts scheme-less
 * input ("wordle.com"). Meta link shims are unwrapped to their destination
 * first (see `unwrapLinkShim`). Returns null when the input isn't a usable
 * http(s) URL with a dotted host.
 */
export function normalizeGameUrl(input: string): string | null {
  const unwrapped = unwrapLinkShim(input);
  if (unwrapped === null) return null;
  const trimmed = unwrapped.trim();
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

/**
 * Minimum consecutive days before the Games UI surfaces a streak flame next to
 * a game's title. Colloquially "a streak" is ≥2 days in a row — a single play
 * is just "played today", not yet a streak worth nudging to protect.
 */
export const STREAK_MIN_DAYS = 2;

/**
 * Step a `YYYY-MM-DD` period key by `delta` days, in UTC so it's DST-proof
 * (period keys are calendar dates, never wall-clock instants). Returns the key
 * unchanged when it isn't a parseable date.
 */
export function shiftPeriodKey(periodKey: string, delta: number): string {
  const [y, m, d] = periodKey.split("-").map(Number);
  if (!y || !m || !d) return periodKey;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * The viewer's current consecutive-day play streak for one game, as of `today`.
 *
 * A streak only counts as "live" when the most recent play is `today` or the
 * day before it — so a run that reached yesterday but hasn't been continued
 * today still counts (that's exactly the "play today to keep your streak"
 * nudge), but a gap of a full day or more resets it to 0. When live, the value
 * is the number of consecutive calendar days ending at that most-recent play.
 *
 * `playedPeriodKeys` is the set of days the viewer has a score on; order and
 * duplicates don't matter, and keys after `today` are simply never reached.
 */
export function computeGameStreak(playedPeriodKeys: Iterable<string>, today: string): number {
  const played = new Set(playedPeriodKeys);
  if (played.size === 0) return 0;
  // Anchor on the most recent of today / yesterday the viewer actually played;
  // anything older means the run already lapsed.
  let cursor: string;
  if (played.has(today)) cursor = today;
  else if (played.has(shiftPeriodKey(today, -1))) cursor = shiftPeriodKey(today, -1);
  else return 0;
  let streak = 0;
  while (played.has(cursor)) {
    streak += 1;
    cursor = shiftPeriodKey(cursor, -1);
  }
  return streak;
}
