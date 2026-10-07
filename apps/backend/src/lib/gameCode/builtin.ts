// The parse / format code the seed migration installed for the registry
// games — each game's `spec` and `formatShareBody` from
// `@workshop/shared/gameRegistry`, ported to JavaScript that satisfies the
// stored-code contract (README.md).
//
// This file is the SEED, not the source of truth. Once the migration has run,
// `games.parse_code` / `format_code` in the database are what executes, and
// operators change them there (`pnpm --filter @workshop/backend run
// admin:game-code`). `seed.test.ts` pins the committed seed migration to this
// file, so editing a block here means writing a new migration that installs
// it — the same as any other schema-shaped change.
//
// Deliberate differences from the registry (everything else is parity-tested
// against it in builtin.parity.test.ts):
//   - Worldle reads the share's real shape, `#Worldle #N (DD.MM.YYYY) N/6`.
//     The registry regex had no room for the date and parsed nothing.
//   - A loss is an explicit `null` ("no result"): Wordle / Worldle / Tradle /
//     Satle `X/6`, Travle `(N away)`, Framed with no 🟩. Anything else the
//     parser does not recognize throws, so it is stored as `failed`.

// biome-ignore-all lint/complexity/noUselessStringRaw: every block is String.raw so a regex added later keeps its backslashes

import { GAME_REGISTRY, type GameKey } from "@workshop/shared/gameRegistry";
import { normalizeGameUrl } from "@workshop/shared/games";

/** Join code fragments into one stored block. */
function block(...parts: string[]): string {
  return `${parts.map((part) => part.trim()).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Shared fragments. Each stored block is self-contained, so a fragment is
// copied into every block that uses it.
// ---------------------------------------------------------------------------

const TO_NUMBER = String.raw`
// "1,000" → 1000. Throws rather than guessing.
function toNumber(text) {
  const digits = text.replace(/,/g, "");
  const n = Number(digits);
  if (digits === "" || !Number.isFinite(n)) throw new Error("not a number: " + text);
  return n;
}`;

const STRIP_URLS = String.raw`
function stripUrls(text) {
  return text.replace(/\bhttps?:\/\/\S+/gi, "");
}`;

const NON_EMPTY_LINES = String.raw`
function nonEmptyLines(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}`;

const IS_GRID_ONLY_LINE = String.raw`
// A line of emoji / box characters only, with an optional "= N" tail (and
// whatever a player typed after it, e.g. "= 13(cheated)").
function isGridOnlyLine(line) {
  return !/[A-Za-z0-9]/.test(line.replace(/=\s*\d+.*$/, ""));
}`;

const GREENS_SPARKLINE = String.raw`
// Collapse a Wordle-style grid to its 🟩 count per guess, plus the N/6 (or X/6)
// from the header: six rows become "🟩 2·3·4·4·4·5 6/6".
function greensSparkline(raw, headerPattern) {
  const lines = nonEmptyLines(stripUrls(raw));
  const greens = lines
    .filter((l) => isGridOnlyLine(l) && /[🟩🟨🟧🟥⬜⬛]/u.test(l))
    .map((l) => (l.match(/🟩/gu) || []).length);
  if (greens.length === 0) return null;
  const header = lines.find((l) => headerPattern.test(l));
  const fraction = header ? (header.match(/(?:\d+|X)\/\d+/i) || [])[0] : undefined;
  const sparkline = "🟩 " + greens.join("·");
  return fraction ? sparkline + " " + fraction : sparkline;
}`;

/**
 * `<Name> #N N/6` games where `X/6` is a loss. `header` is the regex source
 * for everything up to the fraction.
 */
function fractionOfSixParser(example: string, header: string, what: string): string {
  return String.raw`
// ${example}
function parse(raw) {
  const m = raw.match(/${header}(\d+|X)\/6/i);
  if (!m) throw new Error("no ${what} result line");
  return m[1].toUpperCase() === "X" ? null : Number(m[1]);
}`;
}

// ---------------------------------------------------------------------------
// The games
// ---------------------------------------------------------------------------

interface BuiltinGameCode {
  /** Null when the registry has no parser for the game. */
  parse: string | null;
  /** Null when the registry has no formatter (rows show the cleaned raw text). */
  format: string | null;
}

export const BUILTIN_GAME_CODE: Partial<Record<GameKey, BuiltinGameCode>> = {
  anthropeum: {
    parse: block(
      TO_NUMBER,
      String.raw`
// "62,090 · top 38% of players today!" → 62090. The header's "·"
// ("Anthropeum.com · Jun 14 2026") has no digits in front of it.
function parse(raw) {
  const m = raw.match(/([\d,]+(?:\.\d+)?)\s*·/);
  if (!m) throw new Error("no points before a ·");
  return toNumber(m[1]);
}`,
    ),
    format: block(
      NON_EMPTY_LINES,
      String.raw`
// Drop the "Anthropeum.com · <date>" header and the "· top N% of players
// today!" brag; join the emoji grid and the bare score on one line.
function format(raw) {
  const lines = nonEmptyLines(raw)
    .filter((l) => !/anthropeum\.com/i.test(l))
    .map((l) => l.replace(/\s*·.*$/, "").trim());
  return lines.length ? lines.join(" ") : null;
}`,
    ),
  },

  maptap: {
    parse: String.raw`
// "Final score: 970" → 970
function parse(raw) {
  const m = raw.match(/Final score:\s*(\d+)/i);
  if (!m) throw new Error("no Final score line");
  return Number(m[1]);
}
`.trimStart(),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      String.raw`
// Drop the "www.maptap.gg <date>" header; keep the per-round line and the
// Final score line.
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw)).filter((l) => !/^(?:www\.)?maptap\.gg\b/i.test(l));
  return lines.length ? lines.join("\n") : null;
}`,
    ),
  },

  dailytens: {
    parse: String.raw`
// A 5x2 grid of 🏆 (right) / ❌ (wrong); the score is the number of 🏆. An
// all-❌ day is a real 0. A share with no grid at all (just the ?ref= link)
// is not a result.
function parse(raw) {
  if (!/[🏆❌]/u.test(raw)) throw new Error("no 🏆/❌ grid");
  return raw.split("🏆").length - 1;
}
`.trimStart(),
    format: String.raw`
// Turn the 5-row x 2-column grid on its side: the left column becomes the
// first row, the right column the second. Anything but a clean rectangle
// defers to the cleaned raw text.
function format(raw) {
  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\bhttps?:\/\/\S+/gi, "").match(/[🏆❌]/gu) || [])
    .filter((cells) => cells.length > 0);
  if (rows.length === 0) return null;
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) return null;
  const out = [];
  for (let c = 0; c < width; c++) out.push(rows.map((r) => r[c]).join(""));
  return out.join("\n");
}
`.trimStart(),
  },

  satle: {
    parse: block(
      fractionOfSixParser(
        `"🛰Satle #449 5/6" → 5; "X/6" is a loss.`,
        String.raw`Satle\s*#\d+\s+`,
        "Satle",
      ),
    ),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      String.raw`
// "🛰Satle #468 6/6" + grid → "<grid> 6/6"
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw));
  const header = lines.find((l) => /satle/i.test(l));
  const grid = lines.find((l) => isGridOnlyLine(l) && !/satle/i.test(l));
  const fraction = header ? (header.match(/(\d+|X)\/\d+/i) || [])[0] : undefined;
  if (!grid || !fraction) return null;
  return grid + " " + fraction;
}`,
    ),
  },

  travle: {
    parse: String.raw`
// "#travle #1250 +0" → 0 (extra guesses; lower is better).
// "#travle #1250 (9 away)" is a loss.
function parse(raw) {
  const m = raw.match(/#travle\s+#?\d+\s+\+(\d+)/i);
  if (m) return Number(m[1]);
  if (/#travle\s+#?\d+\s+\(\d+\s+away\)/i.test(raw)) return null;
  throw new Error("no #travle result line");
}
`.trimStart(),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      String.raw`
// "#travle #1260 +2" + grid → "<grid> +2" (keeps "(Perfect)" / "(2 hints)")
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw));
  const header = lines.find((l) => /travle/i.test(l));
  const grid = lines.find((l) => isGridOnlyLine(l) && !/travle/i.test(l));
  const score = header ? (header.match(/[+-]\d+(?:\s*\([^)]+\))?/) || [])[0] : undefined;
  if (!grid || !score) return null;
  return grid + " " + score;
}`,
    ),
  },

  globle: {
    parse: String.raw`
// "⬜⬜🟧🟥🟩 = 5" → 5 (guesses; lower is better). The share has one "=".
function parse(raw) {
  const m = raw.match(/=\s*(\d+)/);
  if (!m) throw new Error("no '= N' guess count");
  return Number(m[1]);
}
`.trimStart(),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      String.raw`
// Keep the grid lines up to the one ending "= N" (long runs wrap); drop the
// date / streak header and the trailing hashtag.
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw));
  const start = lines.findIndex(isGridOnlyLine);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i >= start && /=\s*\d+.*$/.test(l));
  if (end === -1) return null;
  return lines.slice(start, end + 1).join("\n");
}`,
    ),
  },

  worldle: {
    parse: block(
      fractionOfSixParser(
        `"#Worldle #1287 (27.08.2026) 4/6 (100%)" → 4; "X/6" is a loss. The date is optional.`,
        String.raw`Worldle\s*#?\d+\s+(?:\([\d.\/-]+\)\s+)?`,
        "Worldle",
      ),
    ),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      GREENS_SPARKLINE,
      String.raw`
function format(raw) {
  return greensSparkline(raw, /worldle/i);
}`,
    ),
  },

  tradle: {
    parse: block(
      fractionOfSixParser(
        `"#Tradle #1547 1/6" → 1; "X/6" is a loss.`,
        String.raw`Tradle\s*#?\d+\s+`,
        "Tradle",
      ),
    ),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      GREENS_SPARKLINE,
      String.raw`
function format(raw) {
  return greensSparkline(raw, /tradle/i);
}`,
    ),
  },

  geosports: {
    parse: block(
      TO_NUMBER,
      String.raw`
// "711 / 1,000" → 711 (points; higher is better)
function parse(raw) {
  const m = raw.match(/([\d,]+)\s*\/\s*[\d,]+/);
  if (!m) throw new Error("no 'N / M' score");
  return toNumber(m[1]);
}`,
    ),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      IS_GRID_ONLY_LINE,
      String.raw`
// Keep the emoji row and the "N / 1,000" line, in that order.
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw));
  const grid = lines.find(isGridOnlyLine);
  const score = lines.find((l) => /[\d,]+\s*\/\s*[\d,]+/.test(l));
  if (!grid || !score) return null;
  return grid + "\n" + score;
}`,
    ),
  },

  ethnoguessr: {
    parse: block(
      TO_NUMBER,
      String.raw`
// "I scored an average of 3197 over 10 rounds …" → 3197. The later "5000
// points on round 2" is a per-round brag, not the score.
function parse(raw) {
  const m = raw.match(/average of\s*([\d,]+)/i);
  if (!m) throw new Error("no 'average of N'");
  return toNumber(m[1]);
}`,
    ),
    format: String.raw`
// Show just the average.
function format(raw) {
  const m = raw.match(/average of\s*([\d,]+)/i);
  return m ? m[1].replace(/,/g, "") : null;
}
`.trimStart(),
  },

  framed: {
    parse: String.raw`
// "🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛" → 3: the guess that landed is the position of 🟩 among
// the squares. No 🟩 is a loss. (Not the puzzle number in "Framed #1234".)
function parse(raw) {
  const squares = raw.match(/🟩|🟥|⬛|⬜/gu);
  if (!squares) throw new Error("no guess squares");
  const at = squares.indexOf("🟩");
  return at === -1 ? null : at + 1;
}
`.trimStart(),
    format: null,
  },

  connections: {
    parse: String.raw`
// One line of four color squares per guess: 4 rows is perfect, each mistake
// adds one. Lower is better.
function parse(raw) {
  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[🟨🟩🟦🟪]{4}$/u.test(l)).length;
  if (rows === 0) throw new Error("no guess rows");
  return rows;
}
`.trimStart(),
    format: block(
      STRIP_URLS,
      NON_EMPTY_LINES,
      String.raw`
// Drop the "Connections" / "Puzzle #N" header lines.
function format(raw) {
  const lines = nonEmptyLines(stripUrls(raw)).filter(
    (l) => !/^Connections$/i.test(l) && !/^Puzzle\s*#?\d+$/i.test(l),
  );
  return lines.length ? lines.join("\n") : null;
}`,
    ),
  },

  strands: {
    parse: String.raw`
// 🔵 found word, 🟡 spangram, 💡 hint used. Score = hints; 0 is perfect.
function parse(raw) {
  if (!/[💡🔵🟡]/u.test(raw)) throw new Error("no Strands grid");
  return raw.split("💡").length - 1;
}
`.trimStart(),
    format: null,
  },

  "nyt-mini": {
    parse: String.raw`
// "… Mini Crossword in 0:16!" → 16 seconds. Reads only m:ss / h:mm:ss, so the
// "5/20/2026" date is never mistaken for the score.
function parse(raw) {
  const m = raw.match(/(?:(\d+):)?(\d+):(\d{2})/);
  if (!m) throw new Error("no m:ss solve time");
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
`.trimStart(),
    format: block(
      STRIP_URLS,
      String.raw`
// The solve time as keycap digits: "0:16" → "0️⃣:1️⃣6️⃣"
function format(raw) {
  const m = stripUrls(raw).match(/\b\d+:\d{2}\b/);
  return m ? m[0].replace(/\d/g, (d) => d + "️⃣") : null;
}`,
    ),
  },

  "spelling-bee": {
    parse: String.raw`
// "I just hit Genius on Spelling Bee." → 9: the rank's position on the ladder.
const RANKS = new Map([
  ["beginner", 1],
  ["good start", 2],
  ["moving up", 3],
  ["good", 4],
  ["solid", 5],
  ["nice", 6],
  ["great", 7],
  ["amazing", 8],
  ["genius", 9],
  ["queen bee", 10],
]);

function parse(raw) {
  const m = raw.match(/(?:hit|reached|got to|made it to)\s+([A-Za-z ]{2,20}?)\s+on/i);
  if (!m) throw new Error("no rank phrase");
  const rank = RANKS.get(m[1].trim().toLowerCase().replace(/\s+/g, " "));
  if (rank === undefined) throw new Error("unknown rank: " + m[1]);
  return rank;
}
`.trimStart(),
    format: null,
  },

  wordle: {
    parse: block(
      fractionOfSixParser(
        `"Wordle 1,127 3/6" → 3; "X/6" is a loss.`,
        String.raw`Wordle\s+[\d,]+\s+`,
        "Wordle",
      ),
    ),
    format: null,
  },
};

/** Every registry game that has builtin code, with its definition. */
export const BUILTIN_GAMES = GAME_REGISTRY.flatMap((def) => {
  const code = BUILTIN_GAME_CODE[def.key];
  return code ? [{ def, code }] : [];
});

/**
 * The builtin code for a `games` row, if the registry has any for it. A
 * catalog game is matched by its `game_key`. A detection-only game
 * (EthnoGuessr) has no key on its row — a player added it by URL — so it is
 * matched by its canonical URL. The seed migration applies the same two
 * rules in SQL (seedSql.ts), and `findOrCreateGame` applies them to every
 * row created afterwards, so a registry game has its code whenever its row
 * came into being.
 */
export function builtinGameCodeFor(game: {
  gameKey: string | null;
  normalizedUrl: string;
}): BuiltinGameCode | null {
  const match = BUILTIN_GAMES.find(({ def }) =>
    def.catalog
      ? game.gameKey === def.key
      : game.gameKey === null && game.normalizedUrl === normalizeGameUrl(def.canonicalUrl),
  );
  return match?.code ?? null;
}
