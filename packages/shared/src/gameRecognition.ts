// Game-score recognition, the deterministic part: given a pasted/shared piece
// of text and a set of candidate games, decide which game (if any) it is a
// score for — without a network call. Order of evidence, cheapest first:
//
//   1. url         — the text contains the game's URL / host
//   2. label       — the text contains the game's title (or the name its
//                    domain carries: `geosports` for geosports.app)
//   3. fingerprint — the text carries the invariant tokens of the game's
//                    stored examples ("New York Times Mini Crossword in",
//                    "Final score:")
//
// Two callers run this exact code. The backend (`lib/gameRecognition.ts`)
// builds fingerprints from stored scores at request time and falls through to
// a classifier when these steps have no answer. The HighScore client runs
// `recognizeWithRecognizers` over a cached set of `GameRecognizer`s — what the
// server derived per game ahead of time — so the share flow names the game
// before any request returns. Recognition only: reading the score out of the
// text stays on the server.
//
// A client-imported subpath: it must not value-import a sibling module.
//
// The numbers below (confidences, thresholds) come from the eval harness
// (apps/backend/scripts/eval-game-recognition.ts) run against prod score
// text — re-run it before changing them.

import type { GameRecognitionMethod } from "./games.js";

/** A game the pasted text could belong to. Mirrors the `games` row. */
export interface RecognitionCandidate {
  id: string;
  title: string;
  /** `games.normalized_url` — `host` or `host/path`, no scheme, no `www.`. */
  normalizedUrl: string;
}

export interface RecognitionResult {
  gameId: string;
  /** 0–1. Compare against `RECOGNITION_SURFACE_THRESHOLD` before surfacing. */
  confidence: number;
  method: GameRecognitionMethod;
}

/**
 * Surface a match to the user ("Detected <game> score — post?") only at or
 * above this confidence. Picked from the eval's precision/recall curve.
 */
export const RECOGNITION_SURFACE_THRESHOLD = 0.8;

// Measured precision of each deterministic step on prod score text.
const URL_CONFIDENCE = 0.99;
const LABEL_CONFIDENCE = 0.97;

// A fingerprint match needs the text to carry most of a game's invariant
// tokens AND to beat the runner-up clearly; anything less goes to the judge.
const FINGERPRINT_MIN_SCORE = 0.8;
const FINGERPRINT_MIN_MARGIN = 0.25;
// One example can't tell an invariant from that day's values, so a
// fingerprint needs at least this many before it may decide on its own.
export const FINGERPRINT_MIN_EXAMPLES = 3;
// A token is "invariant" when at least this share of the examples carry it.
const FINGERPRINT_TOKEN_SUPPORT = 0.6;

// ---------------------------------------------------------------------------
// Step 1 + 2: URL / label
// ---------------------------------------------------------------------------

// Names too generic to identify a game on their own. A game literally titled
// "Daily" still gets recognized — by its URL, or by the later steps.
const LABEL_STOPWORDS = new Set([
  "game",
  "games",
  "daily",
  "play",
  "puzzle",
  "puzzles",
  "quiz",
  "score",
  "scores",
  "share",
  "today",
  "home",
  "login",
  "index",
]);
const LABEL_MIN_LENGTH = 4;
// Titles are page <title>s: "Geozee — Daily Geography Category Puzzle",
// "Size It Up | Magnitudle". The name is the first segment.
const TITLE_SEPARATORS = /\s*[|·—–:]\s*|\s+-\s+/;

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The joined-word forms a game can be named by. "Daily Tens" → `dailytens`
 * (so it matches both "Daily Tens" and "DailyTens"); a game that owns its
 * domain also answers to the domain's name (`geosports.app` → `geosports`).
 */
export function labelsForGame(game: RecognitionCandidate): string[] {
  const labels = new Set<string>();
  const add = (raw: string | undefined) => {
    const joined = wordsOf(raw ?? "").join("");
    if (joined.length >= LABEL_MIN_LENGTH && !LABEL_STOPWORDS.has(joined)) labels.add(joined);
  };
  add(game.title.split(TITLE_SEPARATORS)[0]);
  const [host = "", ...path] = game.normalizedUrl.toLowerCase().split("/");
  const hostParts = host.split(".");
  // Only when the game owns the whole registrable domain: `nytimes.com/games/
  // wordle` must not answer to "nytimes", nor `worldle.teuteuf.fr` to "teuteuf".
  if (path.length === 0 && hostParts.length === 2) add(hostParts[0]);
  return [...labels];
}

const HOST_CHAR = /[a-z0-9-]/;

/**
 * True when `text` (lowercased) contains the game's URL: its host on a host
 * boundary and, when the game lives under a path (`nytimes.com/games/wordle`),
 * that path too. Scheme-less mentions count ("www.maptap.gg October 4").
 */
export function textContainsGameUrl(textLower: string, normalizedUrl: string): boolean {
  const target = normalizedUrl.toLowerCase();
  const slash = target.indexOf("/");
  const hostLength = slash === -1 ? target.length : slash;
  let from = 0;
  for (;;) {
    const at = textLower.indexOf(target, from);
    if (at === -1) return false;
    from = at + 1;
    const before = textLower[at - 1];
    // `bigmaptap.gg` is another site; `www.maptap.gg` is a subdomain of ours.
    if (before !== undefined && HOST_CHAR.test(before)) continue;
    const after = textLower[at + target.length];
    if (after === undefined) return true;
    if (HOST_CHAR.test(after) || after === "_") continue;
    // `maptap.gg.evil.com` is another site; a sentence-ending "." is fine. A
    // game with a path has already matched past its host, so "." is just text.
    const next = textLower[at + target.length + 1];
    if (after === "." && hostLength === target.length && next && HOST_CHAR.test(next)) continue;
    return true;
  }
}

const HOST_IN_TEXT = /(?:[a-z0-9-]+\.)+[a-z]{2,}/g;

/** Host-like tokens in a text, lowercased, without a leading `www.`. */
function hostsIn(text: string): string[] {
  return (text.toLowerCase().match(HOST_IN_TEXT) ?? []).map((h) => h.replace(/^www\./, ""));
}

const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/**
 * The sites a game's shares are known to link: its own host plus every host
 * its examples carry.
 */
export function knownHostsOf(game: RecognitionCandidate, examples: readonly string[]): string[] {
  const known = [game.normalizedUrl.toLowerCase().split("/")[0] as string];
  for (const example of examples) known.push(...hostsIn(example));
  return known;
}

/** True when `text` carries a link and none of its links is one of `knownHosts`. */
export function linksOutside(text: string, knownHosts: readonly string[]): boolean {
  const linked = hostsIn(text);
  if (linked.length === 0) return false;
  return !linked.some((host) => knownHosts.some((site) => sameSite(host, site)));
}

/**
 * True when the text links somewhere this game's shares never do. Sister
 * games share a layout (GeoSports / GeoHistory differ only by name and
 * domain), so a GeoSports paste looks exactly like a GeoHistory score to
 * anything judging by shape — except that it says `www.geosports.app`. The
 * game's known sites are its own URL plus every host its examples carry.
 */
export function linksElsewhere(
  text: string,
  game: RecognitionCandidate,
  examples: readonly string[],
): boolean {
  return linksOutside(text, knownHostsOf(game, examples));
}

// A bare name in prose ("anyone playing wordle today?") is not a score. Every
// real share carries a number or an emoji grid.
const LOOKS_LIKE_RESULT = /\p{N}|\p{Extended_Pictographic}/u;

/** Whether a text carries anything result-like: a number or an emoji. */
export function looksLikeResult(text: string): boolean {
  return LOOKS_LIKE_RESULT.test(text);
}

interface CheapMatch {
  /** The single game the text names, when unambiguous. */
  result: RecognitionResult | null;
  /** Every candidate the text names — more than one means ambiguous. */
  hits: string[];
}

/** Steps 1 + 2 for one fixed candidate set, applied to a text. */
export type CandidateMatcher = (text: string) => CheapMatch;

/**
 * Prepare steps 1 + 2 for a candidate set. Each candidate's names are derived
 * once here rather than once per text: example selection runs the match over
 * every stored score of every candidate, and that added up to ~70ms for a
 * player with 50 games.
 */
export function compileMatcher(candidates: readonly RecognitionCandidate[]): CandidateMatcher {
  const byLabel = new Map<string, RecognitionCandidate[]>();
  for (const game of candidates) {
    for (const label of labelsForGame(game)) {
      const games = byLabel.get(label);
      if (games) games.push(game);
      else byLabel.set(label, [game]);
    }
  }

  return (text) => {
    const textLower = text.toLowerCase();
    const urlHits = candidates.filter((g) => textContainsGameUrl(textLower, g.normalizedUrl));

    let labelHits: Array<{ game: RecognitionCandidate; label: string }> = [];
    if (byLabel.size > 0 && LOOKS_LIKE_RESULT.test(text)) {
      const words = wordsOf(text);
      // Every run of up to 4 consecutive words, joined — so the label
      // `dailytens` matches "Daily Tens" and "DailyTens" alike, on word
      // boundaries ("was at least" never matches `satle`). A game is hit by
      // the longest of its names the text carries.
      const longestLabel = new Map<RecognitionCandidate, string>();
      for (let i = 0; i < words.length; i++) {
        let joined = "";
        for (let n = 0; n < 4 && i + n < words.length; n++) {
          joined += words[i + n];
          for (const game of byLabel.get(joined) ?? []) {
            if (joined.length > (longestLabel.get(game)?.length ?? 0))
              longestLabel.set(game, joined);
          }
        }
      }
      labelHits = candidates
        .filter((game) => longestLabel.has(game))
        .map((game) => ({ game, label: longestLabel.get(game) as string }));
      // "Connections Sports Edition" also contains "Connections": the more
      // specific name wins when it contains every other matched name.
      if (labelHits.length > 1) {
        const [longest, ...rest] = [...labelHits].sort((a, b) => b.label.length - a.label.length);
        if (
          longest &&
          rest.every((h) => h.label !== longest.label && longest.label.includes(h.label))
        ) {
          labelHits = [longest];
        }
      }
    }

    const hits = [...new Set([...urlHits, ...labelHits.map((h) => h.game)].map((g) => g.id))];
    if (hits.length !== 1) return { result: null, hits };
    const gameId = hits[0] as string;
    return {
      result:
        urlHits.length === 1
          ? { gameId, confidence: URL_CONFIDENCE, method: "url" }
          : { gameId, confidence: LABEL_CONFIDENCE, method: "label" },
      hits,
    };
  };
}

/** Steps 1 + 2. Pure and synchronous — microseconds for a My Games list. */
export function matchByUrlOrLabel(
  text: string,
  candidates: readonly RecognitionCandidate[],
): CheapMatch {
  return compileMatcher(candidates)(text);
}

/**
 * Whether a catalog game the player has NOT added may still be a candidate
 * for this text. Its link always counts. Its name only counts for curated
 * (registry) games: any user can add a catalog game titled anything, and one
 * called "Final Score" must not start claiming everybody's MapTap pastes.
 */
export function catalogGameNamedBy(
  text: string,
  game: RecognitionCandidate,
  curated: boolean,
): boolean {
  if (textContainsGameUrl(text.toLowerCase(), game.normalizedUrl)) return true;
  return curated && matchByUrlOrLabel(text, [game]).hits.length > 0;
}

// ---------------------------------------------------------------------------
// Step 3: fingerprint
// ---------------------------------------------------------------------------

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/**
 * The shape of a share text as an unordered token set: its words, its
 * distinct emoji, and its number shapes with every digit run collapsed to `9`
 * ("3/6" → `9/9`, "#1671" → `#9`, "0:43!" → `9:9!`). Unordered, so it survives
 * a game swapping its lines around; digit-blind, so it survives the day's
 * values changing. Links are left out.
 */
export function shapeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // Links are step 1's evidence. Left in, a game whose shares usually end in
  // its URL would stop matching the ones that don't.
  for (const chunk of text.replace(LINK, " ").split(/\s+/)) {
    if (!chunk) continue;
    for (const word of chunk.toLowerCase().match(/\p{L}+/gu) ?? []) tokens.add(`w:${word}`);
    for (const emoji of chunk.match(/\p{Extended_Pictographic}/gu) ?? []) tokens.add(`e:${emoji}`);
    if (/\p{N}/u.test(chunk)) {
      const shape = chunk
        .replace(/\p{L}|\p{Extended_Pictographic}|\ufe0f|\u200d/gu, "")
        .replace(/\p{N}+/gu, "9");
      tokens.add(`n:${shape}`);
    }
  }
  return tokens;
}

/** A game's invariant tokens with the share of its examples carrying each. */
export type Fingerprint = Map<string, number>;

/**
 * Derive a game's fingerprint from its stored examples: the tokens most of
 * them share. One Krillion score gives `krillion`, `#9`, 🦐; five confirm it.
 */
export function buildFingerprint(examples: readonly string[]): Fingerprint {
  const counts = new Map<string, number>();
  for (const example of examples) {
    for (const token of shapeTokens(example)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const fingerprint: Fingerprint = new Map();
  for (const [token, count] of counts) {
    const support = count / examples.length;
    if (support >= FINGERPRINT_TOKEN_SUPPORT) fingerprint.set(token, support);
  }
  return fingerprint;
}

export interface FingerprintScore {
  gameId: string;
  /** 0–1: the weighted share of the game's fingerprint present in the text. */
  score: number;
  examples: number;
}

/** One candidate's fingerprint and how many examples it was derived from. */
export interface FingerprintEntry {
  gameId: string;
  fingerprint: Fingerprint;
  examples: number;
}

/**
 * Score the text against every candidate's fingerprint, best first. A token
 * counts for more the fewer candidates share it (the 🟩 every grid game uses
 * says little; "crossword" says a lot).
 */
export function rankFingerprints(
  text: string,
  entries: readonly FingerprintEntry[],
): FingerprintScore[] {
  const textTokens = shapeTokens(text);
  const gamesWithToken = new Map<string, number>();
  for (const entry of entries) {
    for (const token of entry.fingerprint.keys()) {
      gamesWithToken.set(token, (gamesWithToken.get(token) ?? 0) + 1);
    }
  }
  const scores: FingerprintScore[] = [];
  for (const entry of entries) {
    let present = 0;
    let total = 0;
    for (const [token, support] of entry.fingerprint) {
      const rarity = Math.log(1 + entries.length / (gamesWithToken.get(token) ?? 1));
      const weight = support * rarity;
      total += weight;
      if (textTokens.has(token)) present += weight;
    }
    scores.push({
      gameId: entry.gameId,
      score: total > 0 ? present / total : 0,
      examples: entry.examples,
    });
  }
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * `rankFingerprints` for candidates whose fingerprints are built here, from
 * their examples. Doubles as the judge's shortlist.
 */
export function rankByFingerprint(
  text: string,
  candidates: readonly RecognitionCandidate[],
  examplesByGame: ReadonlyMap<string, readonly string[]>,
): FingerprintScore[] {
  return rankFingerprints(
    text,
    candidates.map((game) => {
      const examples = examplesByGame.get(game.id) ?? [];
      return {
        gameId: game.id,
        fingerprint: buildFingerprint(examples),
        examples: examples.length,
      };
    }),
  );
}

/**
 * Step 3's decision: the best-ranked game, when the text carries most of its
 * fingerprint and clearly more of it than of the runner-up's.
 */
export function fingerprintVerdict(ranked: readonly FingerprintScore[]): RecognitionResult | null {
  const [best, second] = ranked;
  if (
    !best ||
    best.examples < FINGERPRINT_MIN_EXAMPLES ||
    best.score < FINGERPRINT_MIN_SCORE ||
    best.score - (second?.score ?? 0) < FINGERPRINT_MIN_MARGIN
  ) {
    return null;
  }
  return {
    gameId: best.gameId,
    confidence: fingerprintConfidence(best.score),
    method: "fingerprint",
  };
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

/**
 * Whether a stored score is worth showing as an example. People hand-type
 * "Failed", ":/" or "(Cheated)" into a game's score box; teaching recognition
 * that "hi" is a MapTap score would be worse than having one example fewer.
 */
export function isUsableExample(raw: string): boolean {
  const text = raw.trim();
  return text.length >= 12 && LOOKS_LIKE_RESULT.test(text);
}

/** Map a fingerprint score in [min, 1] onto a confidence in [0.85, 0.95]. */
function fingerprintConfidence(score: number): number {
  const span = (score - FINGERPRINT_MIN_SCORE) / (1 - FINGERPRINT_MIN_SCORE);
  return Math.round((0.85 + 0.1 * Math.min(1, Math.max(0, span))) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Recognizers: one game's recognition evidence, derived ahead of time
// ---------------------------------------------------------------------------

/**
 * Everything steps 1–3 need to recognize one game's shares, without the
 * stored scores it was derived from. The server builds these per player
 * (`GET /v1/games/recognizers`) and the client keeps them, so the share flow
 * can name the game with no request. Holds no score text: a fingerprint is
 * only the tokens most of a game's examples share.
 */
export interface GameRecognizer extends RecognitionCandidate {
  url: string;
  /** In the player's My Games when this was built. */
  inMyGames: boolean;
  /**
   * A registry game, which may be recognized by its name even when it is not
   * in My Games. Anything else outside My Games is recognized by link only
   * (see `catalogGameNamedBy`).
   */
  curated: boolean;
  /** How many usable examples the game had. */
  examples: number;
  /**
   * token → share of the examples carrying it. Null below
   * `FINGERPRINT_MIN_EXAMPLES`: too few to decide on, and with one or two
   * texts the "invariant" tokens would be one player's wording.
   */
  fingerprint: Record<string, number> | null;
  /** Hosts its shares link to besides its own, seen in at least two examples. */
  hosts: string[];
}

/** A host must show up in this many examples before a recognizer carries it. */
const RECOGNIZER_HOST_MIN_EXAMPLES = 2;

/** The example-derived half of a `GameRecognizer`. */
export function recognizerEvidence(
  examples: readonly string[],
): Pick<GameRecognizer, "examples" | "fingerprint" | "hosts"> {
  const hostCounts = new Map<string, number>();
  for (const example of examples) {
    for (const host of new Set(hostsIn(example))) {
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    }
  }
  const fingerprint: Record<string, number> = {};
  for (const [token, support] of buildFingerprint(examples)) {
    fingerprint[token] = Math.round(support * 100) / 100;
  }
  return {
    examples: examples.length,
    fingerprint: examples.length >= FINGERPRINT_MIN_EXAMPLES ? fingerprint : null,
    hosts: [...hostCounts]
      .filter(([, count]) => count >= RECOGNIZER_HOST_MIN_EXAMPLES)
      .map(([host]) => host)
      .sort(),
  };
}

/**
 * Steps 1–3 over prepared recognizers: which game `raw` is a score for, or
 * null when these steps cannot say (the caller then asks the server, whose
 * classifier can). Same candidate rule as the server: My Games, plus any
 * other game the text itself names. Synchronous and network-free.
 */
export function recognizeWithRecognizers(
  raw: string,
  recognizers: readonly GameRecognizer[],
): RecognitionResult | null {
  const text = raw.trim();
  if (!text) return null;
  const candidates = recognizers.filter(
    (game) => game.inMyGames || catalogGameNamedBy(text, game, game.curated),
  );
  if (candidates.length === 0) return null;

  const cheap = compileMatcher(candidates)(text);
  if (cheap.result) return cheap.result;
  // Several named games already disagree, and a text with nothing
  // result-like in it is not a score: neither is a fingerprint's to settle.
  if (cheap.hits.length > 0 || !looksLikeResult(text)) return null;

  const byShape = fingerprintVerdict(
    rankFingerprints(
      text,
      candidates.map((game) => ({
        gameId: game.id,
        fingerprint: new Map(Object.entries(game.fingerprint ?? {})),
        examples: game.examples,
      })),
    ),
  );
  if (!byShape) return null;
  const game = candidates.find((g) => g.id === byShape.gameId) as GameRecognizer;
  const known = [game.normalizedUrl.toLowerCase().split("/")[0] as string, ...game.hosts];
  return linksOutside(text, known) ? null : byShape;
}
