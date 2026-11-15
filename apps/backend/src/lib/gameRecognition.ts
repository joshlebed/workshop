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

import {
  type CandidateMatcher,
  compileMatcher,
  fingerprintVerdict,
  isUsableExample,
  linksElsewhere,
  looksLikeResult,
  type RecognitionCandidate,
  type RecognitionResult,
  rankByFingerprint,
} from "@workshop/shared/gameRecognition";

// Steps 1–3 are shared with the HighScore client, which runs them over cached
// recognizers; this file adds what only the server has: stored examples and
// the classifier.
export * from "@workshop/shared/gameRecognition";

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

/** Results below this are noise — report nothing rather than a weak guess. */
const REPORT_FLOOR = 0.5;

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

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
  if (!looksLikeResult(text)) return null;

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
