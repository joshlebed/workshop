// Eval harness for game-score recognition (src/lib/gameRecognition.ts).
//
// Every stored `game_scores.score_raw` is a labelled example of its game. This
// holds each one out, uses the others as that game's examples, and reports
// precision / recall / latency / cost per recognition method — so a change to
// the matcher, the prompt or a threshold can be re-measured instead of argued.
//
//   pnpm --filter @workshop/backend exec tsx scripts/eval-game-recognition.ts \
//     [--snapshot=<file.json>] [--save-snapshot=<file.json>] [--out=<results.json>] \
//     [--cache=<dir>] [--no-jev] [--sample=60] [--verbose]
//
// Data source, in order: `--snapshot` (a file a previous run saved), else
// `EVAL_DATABASE_URL` (opened READ ONLY — point it at prod or a Neon branch),
// else the local `DATABASE_URL` (the dev seed: enough to smoke-test the
// harness, far too small to pick thresholds from). The snapshot holds real
// users' score text: keep it out of the repo.
//
// Jev calls need `TYPESAFE_API_KEY`; responses are cached under `--cache`
// (default /tmp/game-recognition-eval-cache) so a re-run only pays for what
// changed. `--no-jev` runs the deterministic methods alone.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchShareText } from "@workshop/shared/gameRegistry";
import postgres from "postgres";
import {
  catalogGameNamedBy,
  fingerprintVerdict,
  JUDGE_SHORTLIST_SIZE,
  type JudgeRequest,
  MAX_EXAMPLES_PER_GAME,
  matchByUrlOrLabel,
  RECOGNITION_SURFACE_THRESHOLD,
  type RecognitionCandidate,
  type RecognitionResult,
  type RecognitionTrace,
  rankByFingerprint,
  recognizeGame,
  selectExamples,
} from "../src/lib/gameRecognition.js";
import { buildRecognitionChoice, JEV_MODEL } from "../src/lib/jev.js";

// ---------------------------------------------------------------------------
// Args + data
// ---------------------------------------------------------------------------

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k as string, v.join("=") || "1"];
  }),
);
const VERBOSE = args.has("verbose");
const USE_JEV = !args.has("no-jev") && Boolean(process.env.TYPESAFE_API_KEY);
const SAMPLE_PER_GAME = Number(args.get("sample") ?? 60);
const CACHE_DIR = args.get("cache") ?? "/tmp/game-recognition-eval-cache";
const JEV_PRICE_PER_TOKEN = 0.042 / 1_000_000; // jev-1.13: $0.042 / Mtok input, output free

interface GameRow extends RecognitionCandidate {
  gameKey: string | null;
}
interface ScoreRow {
  gameId: string;
  userId: string;
  periodKey: string;
  raw: string;
  createdAt: number;
}
interface Snapshot {
  games: GameRow[];
  scores: ScoreRow[];
  userGames: Array<{ userId: string; gameId: string }>;
}

async function loadSnapshot(): Promise<Snapshot> {
  const file = args.get("snapshot");
  if (file) return normalizeSnapshot(JSON.parse(readFileSync(file, "utf8")));
  const url = process.env.EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("pass --snapshot=<file> or set EVAL_DATABASE_URL / DATABASE_URL");
  // Read only at the session level: this script must never write to a real DB.
  const sql = postgres(url, {
    max: 1,
    connection: { default_transaction_read_only: "on" } as Record<string, string>,
  });
  try {
    const games = await sql`select id, title, normalized_url, game_key from games`;
    const scores = await sql`
      select game_id, user_id, period_key, score_raw, created_at from game_scores order by created_at`;
    const userGames = await sql`select user_id, game_id from user_games`;
    return normalizeSnapshot({ games, scores, userGames });
  } finally {
    await sql.end();
  }
}

// Accepts both the DB's snake_case rows and a saved (camelCase) snapshot.
// biome-ignore lint/suspicious/noExplicitAny: untyped rows from two sources, normalized right here
function normalizeSnapshot(input: any): Snapshot {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: see above
    games: input.games.map((g: any) => ({
      id: g.id,
      title: g.title,
      normalizedUrl: g.normalizedUrl ?? g.normalized_url,
      gameKey: g.gameKey ?? g.game_key ?? null,
    })),
    // biome-ignore lint/suspicious/noExplicitAny: see above
    scores: input.scores.map((s: any) => ({
      gameId: s.gameId ?? s.game_id,
      userId: s.userId ?? s.user_id,
      periodKey: s.periodKey ?? s.period_key,
      raw: s.raw ?? s.score_raw,
      createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.parse(s.created_at),
    })),
    // biome-ignore lint/suspicious/noExplicitAny: see above
    userGames: input.userGames.map((u: any) => ({
      userId: u.userId ?? u.user_id,
      gameId: u.gameId ?? u.game_id,
    })),
  };
}

// ---------------------------------------------------------------------------
// Labelled events
// ---------------------------------------------------------------------------

interface PasteEvent {
  slice: string;
  text: string;
  /** The game the text really is a score for; null = should detect nothing. */
  gold: string | null;
  userId: string | null;
  /** The held-out row, so it (and its day) can be kept out of the examples. */
  source?: ScoreRow;
  /** Game removed from the candidate set (the "absent" slice). */
  withhold?: string;
}

// Things that are not a score for any catalog game. Other daily games on
// purpose: "a real share, but not one of yours" is the realistic near-miss.
const NOISE: string[] = [
  "hi",
  "lol nice",
  "see you at 7",
  "can you grab milk and eggs on the way home",
  "anyone playing wordle today?",
  "I hate connections so much",
  "🔥🔥🔥",
  "😂😂",
  "https://www.nytimes.com/2026/10/01/world/europe/election-results.html",
  "https://youtu.be/dQw4w9WgXcQ",
  "Check out this recipe https://example.com/recipes/42",
  "my flight lands at 6:45pm, gate B12",
  "Meeting moved to 3/6 at 10am",
  "Order #48213 has shipped! Track it at https://ups.com/track?num=1Z999AA10123456784",
  "2-1 final, what a game ⚽",
  "Final score: Lakers 112, Celtics 108",
  "Your verification code is 482913",
  "Morning Run 🏃 5.2 km in 27:41 — https://strava.app.link/abc123",
  "I solved the Rubik's cube in 1:42!",
  "Costcodle #1105 4/6\n⬆️⬆️⬇️✅\nhttps://costcodle.com",
  "Bandle #812 3/6\n⬛⬛🟩⬜⬜⬜\nFound: 5/7 (71%)\n#Bandle #Heardle\n\nhttps://bandle.app/",
  "Flagle #950 (04.10.2026) 3/6\n🟥🟩⬛\n🟩🟩⬛\nhttps://www.flagle.io",
  "Queens #512 | 0:48 🏅\nFirst 👑s: 🟪 🟧 🟦\nlnkd.in/queens",
  "Semantle #1702\n✅ 45 Guesses\n🔝 Guess #44\n🥈 999/1000\nsemantle.com",
  "Daily Quordle 1304\n5️⃣7️⃣\n8️⃣9️⃣\nm-w.com/games/quordle/",
  "TimeGuessr #855 — 38,214/50,000\n🌎🟩🟩🟨 📅🟩🟩⬛\n🌎🟩🟩🟩 📅🟩🟨⬛\nhttps://timeguessr.com",
  "Pokedoku Summary\n📅 2026-10-04\n💯 7/9\n🟩 🟩 🟥\n🟩 🟩 🟩\n🟩 🟥 🟩\npokedoku.com",
  "nerdlegame 1356 4/6\n\n⬛⬛🟪⬛🟪⬛⬛⬛\n🟪🟩⬛🟪⬛🟩⬛⬛\n🟩🟩🟩🟩🟩🟩🟩🟩",
  "Contexto #745 and got it in 38 guesses.\n\n🟩🟩🟩 7\n🟨🟨 9\n🟥🟥🟥🟥 22",
  "#waffle988 3/5\n\n🟩🟩🟩🟩🟩\n🟩⭐🟩⭐🟩\n🟩🟩🟩🟩🟩\n🟩⭐🟩⬜🟩\n🟩🟩🟩🟩🟩\n\n🔥 streak: 12\nwafflegame.net",
];

const isJunk = (text: string) => text.length < 8 || !/\p{N}|\p{Extended_Pictographic}/u.test(text);

function buildEvents(snap: Snapshot): PasteEvent[] {
  const events: PasteEvent[] = [];
  const byId = new Map(snap.games.map((g) => [g.id, g]));
  for (const row of snap.scores) {
    const text = row.raw.trim();
    const filed = byId.get(row.gameId) as GameRow;
    // A score whose text names exactly one other game and not its own was
    // filed under the wrong game (it happens: a Globle paste sits under Geozee).
    const named = matchByUrlOrLabel(text, snap.games).result;
    const misfiled = named && named.gameId !== filed.id ? named.gameId : null;
    // Hand-typed non-results stored in a game's score box ("Failed", ":/").
    // A bare link to the game is not one of those — it still names the game.
    if (isJunk(text) && !named) {
      events.push({ slice: "junk", text, gold: null, userId: row.userId, source: row });
    } else if (misfiled) {
      events.push({ slice: "misfiled", text, gold: misfiled, userId: row.userId, source: row });
    } else {
      events.push({ slice: "real", text, gold: filed.id, userId: row.userId, source: row });
      // The same paste with every line naming the game removed — what is left
      // when someone copies only the grid. Recognition has to work from shape.
      const labels = matchByUrlOrLabel(text, [filed]);
      if (labels.result) {
        const kept = text
          .split(/\r?\n/)
          .filter((line) => !matchByUrlOrLabel(line, [filed]).hits.length)
          .join("\n")
          .trim();
        if (kept && !isJunk(kept)) {
          events.push({
            slice: "headerless",
            text: kept,
            gold: filed.id,
            userId: row.userId,
            source: row,
          });
        }
      }
      // The same paste by someone who hasn't added the game: recognition
      // should still find it in the catalog when the text names it.
      events.push({ slice: "unowned", text, gold: filed.id, userId: row.userId, source: row });
      // The same paste, but the game isn't in the catalog at all: must detect nothing.
      events.push({
        slice: "absent",
        text,
        gold: null,
        userId: row.userId,
        source: row,
        withhold: filed.id,
      });
    }
  }
  for (const text of NOISE) events.push({ slice: "noise", text, gold: null, userId: null });
  return events;
}

/** Deterministic per-game sample so a re-run evaluates the same rows. */
function sample(events: PasteEvent[], perGame: number): PasteEvent[] {
  const groups = new Map<string, PasteEvent[]>();
  for (const e of events) {
    const key = `${e.slice}:${e.gold ?? e.withhold ?? "-"}`;
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as PasteEvent[]).push(e);
  }
  const out: PasteEvent[] = [];
  for (const group of groups.values()) {
    const ranked = group
      .map((e) => ({
        e,
        h: createHash("sha1").update(`${e.slice}${e.text}${e.userId}`).digest("hex"),
      }))
      .sort((a, b) => a.h.localeCompare(b.h));
    out.push(...ranked.slice(0, perGame).map((r) => r.e));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidates + examples for one event
// ---------------------------------------------------------------------------

type CandidateMode = "mine" | "catalog";

class World {
  private readonly scoresByGame = new Map<string, ScoreRow[]>();
  private readonly gamesByUser = new Map<string, Set<string>>();
  readonly gameById: Map<string, GameRow>;

  constructor(readonly snap: Snapshot) {
    this.gameById = new Map(snap.games.map((g) => [g.id, g]));
    // Most recent puzzle day first — the order the service's example query uses.
    const newestFirst = [...snap.scores].sort(
      (a, b) => b.periodKey.localeCompare(a.periodKey) || b.createdAt - a.createdAt,
    );
    for (const s of newestFirst) {
      if (!this.scoresByGame.has(s.gameId)) this.scoresByGame.set(s.gameId, []);
      (this.scoresByGame.get(s.gameId) as ScoreRow[]).push(s);
    }
    for (const u of snap.userGames) {
      if (!this.gamesByUser.has(u.userId)) this.gamesByUser.set(u.userId, new Set());
      (this.gamesByUser.get(u.userId) as Set<string>).add(u.gameId);
    }
  }

  /**
   * `mine` mirrors `loadRecognitionCandidates`: the poster's My Games plus the
   * catalog games the text names. `catalog` is the stress case — every game.
   * A withheld game is gone from both, i.e. not in the catalog at all.
   */
  candidates(event: PasteEvent, mode: CandidateMode): GameRow[] {
    let ids: Set<string>;
    if (mode === "catalog") {
      ids = new Set(this.snap.games.map((g) => g.id));
    } else {
      ids = new Set((event.userId && this.gamesByUser.get(event.userId)) || []);
      if (event.gold) ids.add(event.gold);
      if (event.slice === "unowned") ids.delete(event.gold as string);
      for (const game of this.snap.games) {
        if (catalogGameNamedBy(event.text, game, game.gameKey !== null)) ids.add(game.id);
      }
    }
    if (event.withhold) ids.delete(event.withhold);
    return [...ids].map((id) => this.gameById.get(id) as GameRow);
  }

  /**
   * Stored scores per candidate, most recent first, as the example loader
   * would return them — minus the held-out row and everything from its day
   * (friends posting the same puzzle would make recognition look too easy).
   * `goldCap` limits the true game to its N most recent examples, to measure
   * the "game with only one score so far" regime.
   */
  examples(event: PasteEvent, candidates: GameRow[], goldCap: number): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const game of candidates) {
      const cap = game.id === event.gold ? goldCap : MAX_EXAMPLES_PER_GAME;
      const examples: string[] = [];
      for (const example of this.usableExamples(game)) {
        if (event.source && example.periodKey === event.source.periodKey) continue;
        examples.push(example.text);
        if (examples.length >= cap) break;
      }
      out.set(game.id, examples);
    }
    return out;
  }

  // `selectExamples` over a game's whole history, once. Judged against the
  // full catalog rather than each poster's list, which only makes the
  // "another game's score filed here" filter slightly stricter.
  private readonly usable = new Map<string, Array<{ text: string; periodKey: string }>>();
  private usableExamples(game: GameRow) {
    let cached = this.usable.get(game.id);
    if (!cached) {
      const rows = this.scoresByGame.get(game.id) ?? [];
      const periodByText = new Map<string, string>();
      for (const row of rows) {
        if (!periodByText.has(row.raw.trim())) periodByText.set(row.raw.trim(), row.periodKey);
      }
      cached = selectExamples(
        game,
        rows.map((r) => r.raw),
        this.snap.games,
        Number.POSITIVE_INFINITY,
      ).map((text) => ({ text, periodKey: periodByText.get(text) ?? "" }));
      this.usable.set(game.id, cached);
    }
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Jev (cached, with latency + token accounting)
// ---------------------------------------------------------------------------

interface JevCall {
  answers: Record<string, { type: string; noul?: number; probabilities?: Record<string, number> }>;
  inputTokens: number;
  latencyMs: number;
}
const jevStats = new Map<string, { latency: number[]; tokens: number[]; failures: number }>();

async function callJev(tag: string, state: unknown, questions: unknown): Promise<JevCall | null> {
  const body = JSON.stringify({ model: JEV_MODEL, state, questions });
  const key = createHash("sha256").update(body).digest("hex");
  const file = join(CACHE_DIR, `${key}.json`);
  let call = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as JevCall) : null;
  for (let attempt = 0; !call && attempt < 6; attempt++) {
    const startedAt = performance.now();
    try {
      const res = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      // biome-ignore lint/suspicious/noExplicitAny: eval-only, shape checked by use
      const json = (await res.json()) as any;
      if (!res.ok) {
        console.error(`jev ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
        break;
      }
      call = {
        answers: json.answers,
        inputTokens: json.usage.input_tokens,
        latencyMs: Math.round(performance.now() - startedAt),
      };
      writeFileSync(file, JSON.stringify(call));
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  if (!jevStats.has(tag)) jevStats.set(tag, { latency: [], tokens: [], failures: 0 });
  const stats = jevStats.get(tag) as { latency: number[]; tokens: number[]; failures: number };
  if (!call) {
    stats.failures++;
    return null;
  }
  stats.latency.push(call.latencyMs);
  stats.tokens.push(call.inputTokens);
  return call;
}

/** Design A: one "which of these games, or none" Choice (what ships). */
async function judgeChoice(tag: string, request: JudgeRequest) {
  const { state, question, optionToGameId } = buildRecognitionChoice(request);
  const call = await callJev(tag, state, { game: question });
  const probabilities = call?.answers.game?.probabilities;
  if (!probabilities) return null;
  const out: Record<string, number> = {};
  for (const [option, gameId] of optionToGameId) out[gameId] = probabilities[option] ?? 0;
  return { probabilities: out };
}

/** Design B: one yes/no Noul per game, all in one request (they run in parallel). */
async function judgeNoul(tag: string, request: JudgeRequest) {
  const questions: Record<string, unknown> = {};
  request.games.forEach((game, i) => {
    questions[`q${i}`] = {
      type: "noul",
      instructions: {
        game: { name: game.name, url: game.url, example_scores: game.examples },
        question:
          "`pasted_text` is text a player pasted or shared. Is it a result/score share from `game`? `example_scores` are real result shares from that game: a result from the same game has the same layout and wording, and only the numbers, dates and emoji outcomes change from day to day.",
      },
    };
  });
  const call = await callJev(tag, { pasted_text: request.text }, questions);
  if (!call) return null;
  const out: Record<string, number> = {};
  request.games.forEach((game, i) => {
    out[game.id] = call.answers[`q${i}`]?.noul ?? 0;
  });
  return { probabilities: out };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

type Prediction = RecognitionResult | null;
interface Outcome {
  event: PasteEvent;
  prediction: Prediction;
  trace?: RecognitionTrace;
}
type Method = (event: PasteEvent, candidates: GameRow[]) => Promise<Prediction | Outcome>;

function topOf(probabilities: Record<string, number>, method: "jev"): Prediction {
  let top: Prediction = null;
  for (const [gameId, confidence] of Object.entries(probabilities)) {
    if (!top || confidence > top.confidence) top = { gameId, confidence, method };
  }
  return top;
}

/** pg_trgm-style similarity, for the "would Postgres trigrams do?" question. */
function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}
function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function methods(world: World, goldCap: number): Record<string, Method> {
  const shortlistRequest = (
    event: PasteEvent,
    candidates: GameRow[],
    judgeExamples: number,
  ): JudgeRequest => {
    const examples = world.examples(event, candidates, goldCap);
    const ranked = rankByFingerprint(event.text, candidates, examples).slice(
      0,
      JUDGE_SHORTLIST_SIZE,
    );
    return {
      text: event.text,
      games: ranked.map((r) => {
        const game = world.gameById.get(r.gameId) as GameRow;
        return {
          id: game.id,
          name: game.title,
          url: game.normalizedUrl,
          examples: (examples.get(game.id) ?? []).slice(0, judgeExamples),
        };
      }),
    };
  };
  const jevOnly =
    (judge: typeof judgeChoice, tag: string, judgeExamples: number): Method =>
    async (event, candidates) => {
      // Nobody to choose between (the poster has no other games): nothing to ask.
      if (candidates.length === 0) return null;
      const verdict = await judge(tag, shortlistRequest(event, candidates, judgeExamples));
      return verdict ? topOf(verdict.probabilities, "jev") : null;
    };

  const all: Record<string, Method> = {
    // Today's behaviour: the 17 hand-written registry regexes.
    registry: async (event, candidates) => {
      const def = matchShareText(event.text);
      const game = def && candidates.find((g) => g.gameKey === def.key);
      return game ? { gameId: game.id, confidence: 1, method: "label" } : null;
    },
    "url+label": async (event, candidates) => matchByUrlOrLabel(event.text, candidates).result,
    fingerprint: async (event, candidates) =>
      fingerprintVerdict(
        rankByFingerprint(event.text, candidates, world.examples(event, candidates, goldCap)),
      ),
    trigram: async (event, candidates) => {
      const text = trigrams(event.text);
      const scored = [...world.examples(event, candidates, goldCap)]
        .map(([gameId, examples]) => ({
          gameId,
          score: Math.max(0, ...examples.map((e) => trigramSimilarity(text, trigrams(e)))),
        }))
        .sort((a, b) => b.score - a.score);
      const [best, second] = scored;
      if (!best || best.score - (second?.score ?? 0) < 0.15) return null;
      return { gameId: best.gameId, confidence: best.score, method: "fingerprint" };
    },
  };
  if (USE_JEV) {
    all["jev-choice"] = jevOnly(judgeChoice, "jev-choice", MAX_EXAMPLES_PER_GAME);
    all["jev-noul"] = jevOnly(judgeNoul, "jev-noul", MAX_EXAMPLES_PER_GAME);
    for (const n of [1, 3, 5]) {
      all[`jev-choice@${n}ex`] = jevOnly(judgeChoice, `jev-choice@${n}ex`, n);
    }
  }
  // What ships: url → label → fingerprint → Jev Choice, exactly as the route runs it.
  all.pipeline = async (event, candidates) => {
    const trace: RecognitionTrace = {};
    const prediction = await recognizeGame(event.text, candidates, {
      trace,
      loadExamples: async () => world.examples(event, candidates, goldCap),
      judge: USE_JEV ? (request) => judgeChoice("pipeline", request) : undefined,
    });
    return { event, prediction, trace };
  };
  return all;
}

// ---------------------------------------------------------------------------
// Scoring + report
// ---------------------------------------------------------------------------

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

interface Tally {
  n: number;
  positives: number;
  tp: number;
  fp: number;
  precision: number;
  recall: number;
}

function tally(outcomes: Outcome[], threshold: number): Tally {
  let tp = 0;
  let fp = 0;
  let positives = 0;
  for (const { event, prediction } of outcomes) {
    if (event.gold) positives++;
    if (!prediction || prediction.confidence < threshold) continue;
    if (prediction.gameId === event.gold) tp++;
    else fp++;
  }
  return {
    n: outcomes.length,
    positives,
    tp,
    fp,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: positives === 0 ? 1 : tp / positives,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
};

function table(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

async function run(
  world: World,
  events: PasteEvent[],
  method: Method,
  mode: CandidateMode,
): Promise<Outcome[]> {
  return mapLimit(events, 12, async (event) => {
    const result = await method(event, world.candidates(event, mode));
    return result && "event" in result ? result : { event, prediction: result };
  });
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const snap = await loadSnapshot();
  if (args.get("save-snapshot")) {
    writeFileSync(args.get("save-snapshot") as string, JSON.stringify(snap));
  }
  const world = new World(snap);
  const events = buildEvents(snap);
  const slices = ["real", "misfiled", "unowned", "headerless", "junk", "absent", "noise"];
  const bySlice = (slice: string) => events.filter((e) => e.slice === slice);
  const title = (id: string | null) => (id ? (world.gameById.get(id)?.title ?? id) : "—");
  const results: Record<string, unknown> = {
    model: JEV_MODEL,
    surfaceThreshold: RECOGNITION_SURFACE_THRESHOLD,
  };

  console.log(`# Game recognition eval\n`);
  console.log(
    `${snap.scores.length} scores, ${snap.games.length} games, ${new Set(snap.scores.map((s) => s.gameId)).size} with scores. Jev: ${USE_JEV ? JEV_MODEL : "off"}.\n`,
  );
  console.log(
    table(
      ["slice", "events", "what it is"],
      [
        ["real", bySlice("real").length, "stored score, gold = the game it is filed under"],
        [
          "misfiled",
          bySlice("misfiled").length,
          "stored under one game, text carries another's URL — gold = the other",
        ],
        [
          "headerless",
          bySlice("headerless").length,
          "real score with the lines naming the game removed (synthetic)",
        ],
        ["junk", bySlice("junk").length, 'hand-typed non-results ("Failed", ":/") — gold = none'],
        [
          "unowned",
          bySlice("unowned").length,
          "real score, its game in the catalog but not in the poster's My Games",
        ],
        [
          "absent",
          bySlice("absent").length,
          "real score, its game not in the catalog at all — gold = none",
        ],
        ["noise", bySlice("noise").length, "chat text, links, other games' shares — gold = none"],
      ],
    ),
  );

  // 1. How much does the cheap match resolve on its own? (all rows, no sampling)
  console.log(`\n## Deterministic steps, every row (candidates = the poster's My Games)\n`);
  const detRows: Array<Array<string | number>> = [];
  for (const name of ["registry", "url+label", "fingerprint", "trigram"]) {
    const row: Array<string | number> = [name];
    for (const slice of slices) {
      const outcomes = await run(
        world,
        bySlice(slice),
        methods(world, MAX_EXAMPLES_PER_GAME)[name] as Method,
        "mine",
      );
      const t = tally(outcomes, 0);
      row.push(t.positives ? `${pct(t.recall)} / ${t.fp} wrong` : `${t.fp} false of ${t.n}`);
      results[`deterministic.${name}.${slice}`] = t;
    }
    detRows.push(row);
  }
  console.log(table(["method", ...slices.map((s) => `${s} (recall / errors)`)], detRows));

  // Which real rows does the cheap match miss?
  const cheapMisses = (
    await run(
      world,
      bySlice("real"),
      methods(world, MAX_EXAMPLES_PER_GAME)["url+label"] as Method,
      "mine",
    )
  ).filter((o) => o.prediction?.gameId !== o.event.gold);
  const missByGame = new Map<string, number>();
  for (const o of cheapMisses)
    missByGame.set(title(o.event.gold), (missByGame.get(title(o.event.gold)) ?? 0) + 1);
  console.log(
    `\nReal rows url+label does not resolve: ${cheapMisses.length} of ${bySlice("real").length} — ${[...missByGame].map(([g, n]) => `${g} ${n}`).join(", ")}\n`,
  );
  const hard: PasteEvent[] = cheapMisses.map((o) => ({ ...o.event, slice: "real-hard" }));

  // 2. Shortlist recall: is the true game in the fingerprint's top-K?
  console.log(`## Shortlist: rank of the true game by fingerprint\n`);
  const shortRows: Array<Array<string | number>> = [];
  for (const mode of ["mine", "catalog"] as const) {
    for (const [label, pool] of [
      ["real", sample(bySlice("real"), SAMPLE_PER_GAME)],
      ["headerless", sample(bySlice("headerless"), SAMPLE_PER_GAME)],
      ["real-hard", hard],
    ] as const) {
      for (const cap of [1, 3, MAX_EXAMPLES_PER_GAME]) {
        const ranks = pool.map((event) => {
          const candidates = world.candidates(event, mode);
          const ranked = rankByFingerprint(
            event.text,
            candidates,
            world.examples(event, candidates, cap),
          );
          return ranked.findIndex((r) => r.gameId === event.gold);
        });
        const within = (k: number) =>
          pct(ranks.filter((r) => r >= 0 && r < k).length / Math.max(1, ranks.length));
        shortRows.push([
          mode,
          label,
          cap,
          ranks.length,
          within(1),
          within(3),
          within(JUDGE_SHORTLIST_SIZE),
        ]);
      }
    }
  }
  console.log(
    table(
      [
        "candidates",
        "slice",
        "examples of true game",
        "n",
        "top-1",
        "top-3",
        `top-${JUDGE_SHORTLIST_SIZE}`,
      ],
      shortRows,
    ),
  );

  // 3. Jev designs, on the rows where it matters, by example count.
  const evalSets: Array<[string, PasteEvent[]]> = [
    ["real (sample)", sample(bySlice("real"), SAMPLE_PER_GAME)],
    ["real-hard", hard],
    ["misfiled", bySlice("misfiled")],
    ["headerless (sample)", sample(bySlice("headerless"), Math.ceil(SAMPLE_PER_GAME / 2))],
    ["unowned (sample)", sample(bySlice("unowned"), Math.ceil(SAMPLE_PER_GAME / 3))],
    ["junk", bySlice("junk")],
    ["absent (sample)", sample(bySlice("absent"), Math.ceil(SAMPLE_PER_GAME / 3))],
    ["noise", bySlice("noise")],
  ];
  const thresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
  const allOutcomes = new Map<string, Outcome[]>();
  for (const cap of [1, 3, MAX_EXAMPLES_PER_GAME]) {
    console.log(
      `\n## Methods at threshold ${RECOGNITION_SURFACE_THRESHOLD} — true game has ${cap === MAX_EXAMPLES_PER_GAME ? `up to ${cap}` : cap} example${cap === 1 ? "" : "s"}\n`,
    );
    const m = methods(world, cap);
    const names = Object.keys(m).filter(
      (n) =>
        n !== "registry" && n !== "trigram" && (cap === MAX_EXAMPLES_PER_GAME || !n.includes("@")),
    );
    const rows: Array<Array<string | number>> = [];
    for (const name of names) {
      const row: Array<string | number> = [name];
      const pooled: Outcome[] = [];
      for (const [label, pool] of evalSets) {
        const outcomes = await run(world, pool, m[name] as Method, "mine");
        pooled.push(...outcomes);
        const t = tally(outcomes, RECOGNITION_SURFACE_THRESHOLD);
        row.push(t.positives ? `${pct(t.recall)} / ${t.fp}` : `${t.fp} of ${t.n}`);
        results[`${name}.cap${cap}.${label}`] = t;
      }
      allOutcomes.set(`${name}.cap${cap}`, pooled);
      const overall = tally(pooled, RECOGNITION_SURFACE_THRESHOLD);
      row.push(pct(overall.precision), pct(overall.recall));
      rows.push(row);
    }
    console.log(
      table(
        ["method", ...evalSets.map(([l]) => `${l} (recall / wrong)`), "precision", "recall"],
        rows,
      ),
    );
  }

  // 4. Precision / recall by threshold.
  console.log(`\n## Precision / recall by confidence threshold (all eval sets pooled)\n`);
  const curveRows: Array<Array<string | number>> = [];
  for (const [key, outcomes] of allOutcomes) {
    if (!/^(jev-choice|jev-noul|pipeline)\.cap/.test(key)) continue;
    const row: Array<string | number> = [key];
    for (const th of thresholds) {
      const t = tally(outcomes, th);
      row.push(`${pct(t.precision)} / ${pct(t.recall)}`);
      results[`curve.${key}.${th}`] = t;
    }
    curveRows.push(row);
  }
  console.log(table(["method", ...thresholds.map((t) => `≥${t} (P / R)`)], curveRows));

  // 5. The shipped pipeline: which step answered, and what it got wrong.
  for (const cap of [1, MAX_EXAMPLES_PER_GAME]) {
    const outcomes = allOutcomes.get(`pipeline.cap${cap}`) ?? [];
    const byMethod = new Map<string, { n: number; right: number }>();
    let judged = 0;
    for (const o of outcomes) {
      if (o.trace?.judgeCalled) judged++;
      const key = o.prediction?.method ?? "none";
      const entry = byMethod.get(key) ?? { n: 0, right: 0 };
      entry.n++;
      if ((o.prediction?.gameId ?? null) === o.event.gold) entry.right++;
      byMethod.set(key, entry);
    }
    console.log(
      `\n## Pipeline, by deciding step (true game has ${cap === 1 ? "1 example" : `up to ${cap}`})\n`,
    );
    console.log(
      table(
        ["step", "decisions", "correct"],
        [...byMethod].map(([k, v]) => [k, v.n, `${v.right} (${pct(v.right / v.n)})`]),
      ),
    );
    console.log(`\nJev was called on ${judged} of ${outcomes.length} eval events.`);
    const confusions = new Map<string, number>();
    for (const o of outcomes) {
      if (!o.prediction || o.prediction.confidence < RECOGNITION_SURFACE_THRESHOLD) continue;
      if (o.prediction.gameId === o.event.gold) continue;
      const key = `${o.event.slice}: ${title(o.event.gold ?? o.event.withhold ?? null)} → ${title(o.prediction.gameId)} (${o.prediction.method})`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
    console.log(
      `\nSurfaced wrong (≥${RECOGNITION_SURFACE_THRESHOLD}): ${confusions.size === 0 ? "none" : ""}`,
    );
    for (const [k, n] of [...confusions].sort((a, b) => b[1] - a[1])) console.log(`- ${n}× ${k}`);
    if (VERBOSE) {
      for (const o of outcomes) {
        const right = (o.prediction?.gameId ?? null) === o.event.gold;
        if (right && (o.prediction?.confidence ?? 1) >= RECOGNITION_SURFACE_THRESHOLD) continue;
        console.log(
          `  [${o.event.slice}] gold=${title(o.event.gold)} got=${title(o.prediction?.gameId ?? null)} ${o.prediction?.method ?? ""} ${o.prediction?.confidence ?? ""} guess=${JSON.stringify(o.trace?.bestGuess ?? null)} :: ${JSON.stringify(o.event.text.slice(0, 120))}`,
        );
      }
    }
  }

  // 6. Confusable pairs under the pipeline.
  console.log(
    `\n## Confusable pairs (pipeline, up to ${MAX_EXAMPLES_PER_GAME} examples, every real + headerless row for these games)\n`,
  );
  const families = [
    ["Wordle", "Worldle", "Tradle", "Travle", "Satle"],
    ["GeoSports", "GeoHistory"],
    ["Globle", "Geozee"],
  ];
  const famRows: Array<Array<string | number>> = [];
  for (const family of families) {
    const ids = new Set(
      snap.games.filter((g) => family.some((f) => g.title.startsWith(f))).map((g) => g.id),
    );
    for (const slice of ["real", "headerless", "absent"]) {
      const pool = sample(
        events.filter((e) => e.slice === slice && ids.has((e.gold ?? e.withhold) as string)),
        SAMPLE_PER_GAME,
      );
      // Worst case: every member of the family is a candidate (minus the withheld one).
      const outcomes = await mapLimit(pool, 12, async (event) => {
        const candidates = world.candidates(event, "catalog");
        const prediction = await recognizeGame(event.text, candidates, {
          loadExamples: async () => world.examples(event, candidates, MAX_EXAMPLES_PER_GAME),
          judge: USE_JEV ? (request) => judgeChoice("pipeline", request) : undefined,
        });
        return { event, prediction };
      });
      const t = tally(outcomes, RECOGNITION_SURFACE_THRESHOLD);
      const crossed = outcomes.filter(
        (o) =>
          o.prediction &&
          o.prediction.confidence >= RECOGNITION_SURFACE_THRESHOLD &&
          o.prediction.gameId !== o.event.gold &&
          ids.has(o.prediction.gameId),
      ).length;
      famRows.push([
        family.join(" / "),
        slice,
        t.n,
        t.positives ? pct(t.recall) : "—",
        t.fp,
        crossed,
      ]);
    }
  }
  console.log(
    table(
      ["family", "slice", "n", "recall", "surfaced wrong", "…of which a family member"],
      famRows,
    ),
  );

  // 7. Latency + cost.
  if (USE_JEV) {
    console.log(
      `\n## Jev latency and cost (uncached calls measure latency; all calls measure tokens)\n`,
    );
    const rows = [...jevStats].map(([tag, s]) => [
      tag,
      s.tokens.length,
      Math.round(quantile(s.latency, 0.5)),
      Math.round(quantile(s.latency, 0.95)),
      Math.round(quantile(s.tokens, 0.5)),
      Math.round(quantile(s.tokens, 0.95)),
      `$${(quantile(s.tokens, 0.5) * JEV_PRICE_PER_TOKEN).toFixed(5)}`,
      s.failures,
    ]);
    console.log(
      table(
        [
          "method",
          "calls",
          "p50 ms",
          "p95 ms",
          "p50 tokens",
          "p95 tokens",
          "cost / call (p50)",
          "failed",
        ],
        rows,
      ),
    );
    results.jev = Object.fromEntries(
      [...jevStats].map(([tag, s]) => [
        tag,
        {
          calls: s.tokens.length,
          p50ms: quantile(s.latency, 0.5),
          p95ms: quantile(s.latency, 0.95),
          p50tokens: quantile(s.tokens, 0.5),
          p95tokens: quantile(s.tokens, 0.95),
          failures: s.failures,
        },
      ]),
    );
  }
  if (args.get("out")) writeFileSync(args.get("out") as string, JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
