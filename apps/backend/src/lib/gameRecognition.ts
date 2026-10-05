// Game-score recognition: given a pasted/shared piece of text and a bounded
// set of candidate games, decide which game (if any) it is a score for.
//
// Recognition is never "taught". Every stored `game_scores.score_raw` is a
// labelled example of its game, so this works from a game's first score and
// sharpens as more arrive. Order of evidence, cheapest first:
//
//   1. url         — the text contains the game's URL / host
//   2. label       — the text contains the game's title (or the name its
//                    domain carries: `geosports` for geosports.app)
//   3. fingerprint — the text carries the invariant tokens of the game's
//                    stored examples ("New York Times Mini Crossword in",
//                    "Final score:") — deterministic, no network
//   4. jev         — TypeSafe's Jev picks one of a fingerprint-ranked
//                    shortlist, or none
//
// Steps 1–3 are pure. Step 4 is injected (`judge`) so this module stays
// route- and network-independent: the score-post "wrong game?" check, the
// paste-sheet endpoint and the eval harness (scripts/eval-game-recognition.ts)
// all run this exact code. Everything after step 2 is lazy — examples are only
// loaded when the cheap match finds nothing — and fails soft: a judge that
// throws, times out or returns null degrades to "no detection".
//
// The numbers below (confidences, thresholds) come from the eval harness run
// against prod score text — re-run it before changing them.

import type { GameRecognitionMethod } from "@workshop/shared/games";

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

/** What the judge (Jev) is asked: the text plus a shortlist with examples. */
export interface JudgeRequest {
  text: string;
  games: Array<{ id: string; name: string; url: string; examples: string[] }>;
}

/** Probability per shortlisted game id; whatever is left over is "none". */
export interface JudgeVerdict {
  probabilities: Record<string, number>;
}

type RecognitionJudge = (request: JudgeRequest) => Promise<JudgeVerdict | null>;

/** Stored example score texts per candidate game id, most recent first. */
export type ExampleLoader = (gameIds: string[]) => Promise<Map<string, string[]>>;

interface RecognizeOptions {
  /** Lazily loads examples; only called when the cheap match finds nothing. */
  loadExamples?: ExampleLoader | undefined;
  /** The Jev call. Omit to stop after the deterministic steps. */
  judge?: RecognitionJudge | undefined;
  /** Reports which steps ran — shadow-mode logging and the eval read this. */
  trace?: RecognitionTrace | undefined;
}

/** Filled in as recognition runs; purely observational. */
export interface RecognitionTrace {
  /** Candidates named by the cheap match (>1 means it was ambiguous). */
  cheapHits?: string[];
  examplesLoaded?: boolean;
  /** Candidate ids sent to the judge, best fingerprint first. */
  shortlist?: string[];
  judgeCalled?: boolean;
  judgeFailed?: boolean;
  /** Best result below the reporting floor, when nothing was returned. */
  bestGuess?: RecognitionResult | null;
}

/**
 * Surface a match to the user ("Detected <game> score — post?") only at or
 * above this confidence. Picked from the eval's precision/recall curve.
 */
export const RECOGNITION_SURFACE_THRESHOLD = 0.8;

/** Up to this many of a game's most recent distinct scores are its examples. */
export const MAX_EXAMPLES_PER_GAME = 20;
/**
 * Ceiling on example text per judge call, in characters. Jev rejects a
 * question over 32k tokens; an emoji grid runs well over a token per
 * character, and a rejected call is a lost detection.
 */
const JUDGE_EXAMPLE_CHAR_BUDGET = 24_000;
/**
 * The judge sees the same number of examples for every shortlisted game: as
 * many as the game with the fewest has, but at least this many. Measured both
 * ways — 20 each beats 5 each when every game has 20 (a game that changed its
 * layout is only recognizable from examples old enough to show the old one),
 * but 20 for the established games against 1 for a newly added one pulls the
 * judge toward the established games.
 */
const JUDGE_BALANCED_EXAMPLES_FLOOR = 5;
/** Games sent to the judge — the fingerprint ranking picks them. */
export const JUDGE_SHORTLIST_SIZE = 8;
/** A single example is clipped to this many characters before it is sent. */
const EXAMPLE_MAX_CHARS = 400;

// Measured precision of each deterministic step on prod score text.
const URL_CONFIDENCE = 0.99;
const LABEL_CONFIDENCE = 0.97;

// A fingerprint match needs the text to carry most of a game's invariant
// tokens AND to beat the runner-up clearly; anything less goes to the judge.
const FINGERPRINT_MIN_SCORE = 0.8;
const FINGERPRINT_MIN_MARGIN = 0.25;
// One example can't tell an invariant from that day's values, so a
// fingerprint needs at least this many before it may decide on its own.
const FINGERPRINT_MIN_EXAMPLES = 3;
// A token is "invariant" when at least this share of the examples carry it.
const FINGERPRINT_TOKEN_SUPPORT = 0.6;
/** Results below this are noise — report nothing rather than a weak guess. */
const REPORT_FLOOR = 0.5;

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
export function hostsIn(text: string): string[] {
  return (text.toLowerCase().match(HOST_IN_TEXT) ?? []).map((h) => h.replace(/^www\./, ""));
}

const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

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
  const linked = hostsIn(text);
  if (linked.length === 0) return false;
  const known = [game.normalizedUrl.toLowerCase().split("/")[0] as string];
  for (const example of examples) known.push(...hostsIn(example));
  return !linked.some((host) => known.some((site) => sameSite(host, site)));
}

// A bare name in prose ("anyone playing wordle today?") is not a score. Every
// real share carries a number or an emoji grid.
const LOOKS_LIKE_RESULT = /\p{N}|\p{Extended_Pictographic}/u;

interface CheapMatch {
  /** The single game the text names, when unambiguous. */
  result: RecognitionResult | null;
  /** Every candidate the text names — more than one means ambiguous. */
  hits: string[];
}

/** Steps 1 + 2 for one fixed candidate set, applied to a text. */
type CandidateMatcher = (text: string) => CheapMatch;

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
type Fingerprint = Map<string, number>;

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

interface FingerprintScore {
  gameId: string;
  /** 0–1: the weighted share of the game's fingerprint present in the text. */
  score: number;
  examples: number;
}

/**
 * Score the text against every candidate's fingerprint, best first. A token
 * counts for more the fewer candidates share it (the 🟩 every grid game uses
 * says little; "crossword" says a lot). Doubles as the judge's shortlist.
 */
export function rankByFingerprint(
  text: string,
  candidates: readonly RecognitionCandidate[],
  examplesByGame: ReadonlyMap<string, readonly string[]>,
): FingerprintScore[] {
  const textTokens = shapeTokens(text);
  const fingerprints = new Map<string, Fingerprint>();
  const gamesWithToken = new Map<string, number>();
  for (const game of candidates) {
    const fingerprint = buildFingerprint(examplesByGame.get(game.id) ?? []);
    fingerprints.set(game.id, fingerprint);
    for (const token of fingerprint.keys()) {
      gamesWithToken.set(token, (gamesWithToken.get(token) ?? 0) + 1);
    }
  }
  const scores: FingerprintScore[] = [];
  for (const game of candidates) {
    const fingerprint = fingerprints.get(game.id) as Fingerprint;
    let present = 0;
    let total = 0;
    for (const [token, support] of fingerprint) {
      const rarity = Math.log(1 + candidates.length / (gamesWithToken.get(token) ?? 1));
      const weight = support * rarity;
      total += weight;
      if (textTokens.has(token)) present += weight;
    }
    scores.push({
      gameId: game.id,
      score: total > 0 ? present / total : 0,
      examples: examplesByGame.get(game.id)?.length ?? 0,
    });
  }
  return scores.sort((a, b) => b.score - a.score);
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

/**
 * Reduce a game's stored scores (most recent first) to its examples: usable,
 * distinct, not obviously another candidate's score filed here by mistake,
 * capped at `MAX_EXAMPLES_PER_GAME`.
 */
export function selectExamples(
  game: RecognitionCandidate,
  storedScores: readonly string[],
  candidates: readonly RecognitionCandidate[] | CandidateMatcher,
  limit = MAX_EXAMPLES_PER_GAME,
): string[] {
  const match = typeof candidates === "function" ? candidates : compileMatcher(candidates);
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const raw of storedScores) {
    const text = raw.trim();
    if (!isUsableExample(text) || seen.has(text)) continue;
    seen.add(text);
    const named = match(text).result;
    if (named && named.gameId !== game.id) continue;
    examples.push(text.length > EXAMPLE_MAX_CHARS ? text.slice(0, EXAMPLE_MAX_CHARS) : text);
    if (examples.length >= limit) break;
  }
  return examples;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Decide which candidate game `raw` is a score for, or null. Never throws:
 * a failing example loader or judge degrades to "no detection".
 */
export async function recognizeGame(
  raw: string,
  candidates: readonly RecognitionCandidate[],
  options: RecognizeOptions = {},
): Promise<RecognitionResult | null> {
  const trace = options.trace ?? {};
  const text = raw.trim();
  if (!text || candidates.length === 0) return null;

  const match = compileMatcher(candidates);
  const cheap = match(text);
  trace.cheapHits = cheap.hits;
  if (cheap.result) return cheap.result;
  if (!options.loadExamples) return null;

  // The text names several games (a multi-game recap, or a typo'd paste):
  // only those are still in the running. Otherwise everyone is.
  const pool =
    cheap.hits.length > 1 ? candidates.filter((g) => cheap.hits.includes(g.id)) : candidates;

  let stored: Map<string, string[]>;
  try {
    stored = await options.loadExamples(pool.map((g) => g.id));
  } catch {
    return null;
  }
  trace.examplesLoaded = true;
  const examplesByGame = new Map<string, string[]>();
  for (const game of pool) {
    examplesByGame.set(game.id, selectExamples(game, stored.get(game.id) ?? [], match));
  }

  // A text with nothing result-like in it ("hi", "Gave up") is not a score
  // for anything — don't spend a judge call finding that out.
  if (!LOOKS_LIKE_RESULT.test(text)) return null;

  const contradicted = (gameId: string) =>
    linksElsewhere(
      text,
      pool.find((g) => g.id === gameId) as RecognitionCandidate,
      examplesByGame.get(gameId) ?? [],
    );
  const ranked = rankByFingerprint(text, pool, examplesByGame);
  // Several named games means the names already disagree — a fingerprint
  // can't settle that, so it only decides when the cheap match found nothing.
  const byShape = cheap.hits.length === 0 ? fingerprintVerdict(ranked) : null;
  if (byShape && !contradicted(byShape.gameId)) return byShape;

  if (!options.judge) return null;
  const shortlist = ranked.slice(0, JUDGE_SHORTLIST_SIZE);
  const fewest = Math.min(...shortlist.map((s) => s.examples).filter((n) => n > 0));
  const examplesEach = Math.max(
    JUDGE_BALANCED_EXAMPLES_FLOOR,
    Number.isFinite(fewest) ? fewest : 0,
  );
  trace.shortlist = shortlist.map((s) => s.gameId);
  trace.judgeCalled = true;
  let verdict: JudgeVerdict | null;
  try {
    verdict = await options.judge({
      text,
      games: fitToBudget(
        shortlist.map((s) => {
          const game = pool.find((g) => g.id === s.gameId) as RecognitionCandidate;
          return {
            id: game.id,
            name: game.title,
            url: game.normalizedUrl,
            examples: (examplesByGame.get(game.id) ?? []).slice(0, examplesEach),
          };
        }),
      ),
    });
  } catch {
    verdict = null;
  }
  if (!verdict) {
    trace.judgeFailed = true;
    return null;
  }

  let top: RecognitionResult | null = null;
  for (const s of shortlist) {
    const confidence = verdict.probabilities[s.gameId] ?? 0;
    if (!top || confidence > top.confidence) top = { gameId: s.gameId, confidence, method: "jev" };
  }
  if (!top || top.confidence < REPORT_FLOOR || contradicted(top.gameId)) {
    trace.bestGuess = top;
    return null;
  }
  return top;
}

/**
 * Trim the shortlist's examples to the judge's character budget, fairly:
 * every game keeps its most recent example before any game keeps a second.
 */
export function fitToBudget(
  games: JudgeRequest["games"],
  budget = JUDGE_EXAMPLE_CHAR_BUDGET,
): JudgeRequest["games"] {
  const kept = games.map((game) => ({ ...game, examples: [] as string[] }));
  let remaining = budget;
  for (let round = 0; round < MAX_EXAMPLES_PER_GAME; round++) {
    for (const [i, game] of games.entries()) {
      const example = game.examples[round];
      if (example === undefined || example.length > remaining) continue;
      kept[i]?.examples.push(example);
      remaining -= example.length;
    }
  }
  return kept;
}

/** Map a fingerprint score in [min, 1] onto a confidence in [0.85, 0.95]. */
function fingerprintConfidence(score: number): number {
  const span = (score - FINGERPRINT_MIN_SCORE) / (1 - FINGERPRINT_MIN_SCORE);
  return Math.round((0.85 + 0.1 * Math.min(1, Math.max(0, span))) * 100) / 100;
}
