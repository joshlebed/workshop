// Hand-written `format` code for catalog games whose rows otherwise show the
// cleaned raw share (no `format_code`). Each block satisfies the stored-code
// contract in README.md and is installed into `games.format_code` by
// `scripts/apply-handwritten-formatters.ts`, which validates it against the
// game's stored scores first and records a `game_code_revisions` row.
//
// The database is what executes; this file is the reviewed source of the
// operator-written blocks, pinned by handwritten.test.ts (each example's
// `expectedSummary` is what the sandbox must produce). Edit here, re-run the
// apply script, and the revision history shows the change.
//
// Conventions, borrowed from the registry formatters in builtin.ts: drop the
// header, URLs and hashtag lines; keep the visual grid; keep a fraction or
// percentile only when it says something the score value does not.

// biome-ignore-all lint/complexity/noUselessStringRaw: every block is String.raw so a regex added later keeps its backslashes

interface HandwrittenFormatter {
  /** `game_key` for a registry game, `normalized_url` for a taught one. */
  ref: string;
  /** For the apply script's output only. */
  title: string;
  /** The stored `format_code`. */
  format: string;
  /** Shares in the shapes prod holds, with the summary each must produce. */
  examples: ReadonlyArray<{
    raw: string;
    expected?: number | null;
    expectedSummary: string | null;
  }>;
}

/** Helpers copied into every block that uses them (blocks are self-contained). */
const LINES = String.raw`
// Non-blank lines with URLs (bare or <angle-bracketed>) and hashtag-only lines removed.
function lines(raw) {
  return raw
    .split(/\r?\n/)
    .map(function (l) { return l.replace(/<?\bhttps?:\/\/\S+>?/gi, "").trim(); })
    .filter(function (l) { return l.length > 0 && !/^#\S+$/.test(l); });
}`;

const IS_GRID = String.raw`
// A line of emoji / box characters only — no letters or digits.
function isGrid(line) {
  return !/[A-Za-z0-9]/.test(line);
}`;

function block(...parts: string[]): string {
  return `${parts.map((part) => part.trim()).join("\n\n")}\n`;
}

/** Header off, grid kept: Wordle, Le Mot, Spotle, Framed, Krillion-style shares. */
const GRID_ONLY = block(
  LINES,
  IS_GRID,
  String.raw`
function format(raw) {
  var grid = lines(raw).filter(isGrid);
  return grid.length ? grid.join("\n") : null;
}`,
);

export const HANDWRITTEN_FORMATTERS: ReadonlyArray<HandwrittenFormatter> = [
  {
    ref: "wordle",
    title: "Wordle",
    format: GRID_ONLY,
    examples: [
      {
        raw: "Wordle 1,962 4/6\n\n⬜⬜🟨⬜⬜\n⬜🟨⬜⬜⬜\n🟩⬜🟩🟩⬜\n🟩🟩🟩🟩🟩",
        expectedSummary: "⬜⬜🟨⬜⬜\n⬜🟨⬜⬜⬜\n🟩⬜🟩🟩⬜\n🟩🟩🟩🟩🟩",
      },
      {
        raw: "Archive October 31, 2026\nWordle 1,960 3/6\n\n🟨⬜⬜⬜⬜\n⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩",
        expectedSummary: "🟨⬜⬜⬜⬜\n⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩",
      },
      { raw: "https://www.nytimes.com/games/wordle", expectedSummary: null },
    ],
  },
  {
    ref: "wordle.louan.me",
    title: "Le Mot",
    format: GRID_ONLY,
    examples: [
      {
        raw: "Le Mot (@WordleFR) #1758 4/6\n\n⬛⬛⬛⬛🟨\n🟩🟩🟨⬛⬛\n🟩🟩⬛🟩🟩\n🟩🟩🟩🟩🟩\n\nhttps://wordle.louan.me",
        expectedSummary: "⬛⬛⬛⬛🟨\n🟩🟩🟨⬛⬛\n🟩🟩⬛🟩🟩\n🟩🟩🟩🟩🟩",
      },
      {
        raw: "Le Mot (@WordleFR) #1758 💀/6\n\n⬛⬛🟨⬛🟩\n⬛🟩⬛🟩🟩\n🟩🟩⬛🟩🟩\n\nhttps://wordle.louan.me",
        expectedSummary: "⬛⬛🟨⬛🟩\n⬛🟩⬛🟩🟩\n🟩🟩⬛🟩🟩",
      },
    ],
  },
  {
    ref: "spotle.io",
    title: "Spotle",
    // Guess the artist: one 🟩🟨⬜ row per guess over six attribute columns,
    // under a legend row of category emoji. Keep the legend + grid.
    format: GRID_ONLY,
    examples: [
      {
        raw: "Spotle.io #1646\n\n📅🦇📈👻💽🎃\n⬜⬜⬜🟩⬜🟩\n🟨🟩⬜🟩⬜🟩\n⬜🟩⬜🟩⬜🟩\n🟩🟩🟩🟩🟩🟩",
        expectedSummary: "📅🦇📈👻💽🎃\n⬜⬜⬜🟩⬜🟩\n🟨🟩⬜🟩⬜🟩\n⬜🟩⬜🟩⬜🟩\n🟩🟩🟩🟩🟩🟩",
      },
      {
        raw: "Spotle.io #1646\n\n📅🦇📈👻💽🎃\n⬜🟩⬜🟩⬜🟩\n⬜🟩🟨🟩🟩⬜",
        expectedSummary: "📅🦇📈👻💽🎃\n⬜🟩⬜🟩⬜🟩\n⬜🟩🟨🟩🟩⬜",
      },
    ],
  },
  {
    ref: "framed",
    title: "Framed",
    format: GRID_ONLY,
    examples: [
      {
        raw: "Framed #1234\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛\nhttps://framed.wtf",
        expectedSummary: "🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛",
      },
      { raw: "Framed #1234\n🎥 🟥 🟥 🟥 🟥 🟥 🟥", expectedSummary: "🎥 🟥 🟥 🟥 🟥 🟥 🟥" },
    ],
  },
  {
    ref: "strands",
    title: "Strands",
    format: block(
      LINES,
      String.raw`
function format(raw) {
  var grid = lines(raw).filter(function (l) { return /^[🔵🟡💡]+$/u.test(l); });
  return grid.length ? grid.join("\n") : null;
}`,
    ),
    examples: [
      {
        raw: 'Strands #432\n"Today\'s theme"\n💡🔵🔵🟡\n🔵🔵🔵🔵',
        expectedSummary: "💡🔵🔵🟡\n🔵🔵🔵🔵",
      },
      { raw: "https://www.nytimes.com/games/strands", expectedSummary: null },
    ],
  },
  {
    ref: "spelling-bee",
    title: "Spelling Bee",
    format: block(String.raw`
// "I just hit Genius on Spelling Bee." → "🐝 Genius"
function format(raw) {
  var m = raw.match(/(?:hit|reached|got to|made it to)\s+([A-Za-z ]{2,20}?)\s+on/i);
  return m ? "🐝 " + m[1].trim() : null;
}`),
    examples: [
      { raw: "I just hit Genius on Spelling Bee.", expectedSummary: "🐝 Genius" },
      { raw: "I just hit Queen Bee on Spelling Bee!", expectedSummary: "🐝 Queen Bee" },
    ],
  },
  {
    ref: "krillion.io",
    title: "Krillion",
    format: block(
      LINES,
      IS_GRID,
      String.raw`
// "Krillion #110 🦐\n360\n\n🦑🏮🐟🦑🐟🫧🏮" → "🦑🏮🐟🦑🐟🫧🏮 360"
function format(raw) {
  var ls = lines(raw);
  var grid = ls.find(isGrid);
  var score = ls.find(function (l) { return /^\d+$/.test(l); });
  if (!grid) return null;
  return score ? grid + " " + score : grid;
}`,
    ),
    examples: [
      { raw: "Krillion #110 🦐\n360\n\n🦑🏮🐟🦑🐟🫧🏮", expectedSummary: "🦑🏮🐟🦑🐟🫧🏮 360" },
      { raw: "Krillion #81 🦐\n415\n\n🦑🫧🏮🐟🦑🦑🫧", expectedSummary: "🦑🫧🏮🐟🦑🦑🫧 415" },
    ],
  },
  {
    ref: "geozee.earth",
    title: "Geozee",
    format: block(
      LINES,
      String.raw`
// Keep the 3×3 grid and "N/M · top X%". The flag row is the clue, not the result.
function format(raw) {
  var ls = lines(raw);
  var grid = ls.filter(function (l) { return /^[🟩🟨🟥⬜⬛]+$/u.test(l); });
  var header = ls.find(function (l) { return /\d+\/\d+/.test(l); });
  var score = header ? (header.match(/\d+\/\d+(?:\s*·\s*top \d+%)?/) || [])[0] : undefined;
  if (grid.length === 0 && !score) return null;
  return grid.concat(score ? [score] : []).join("\n");
}`,
    ),
    examples: [
      {
        raw: "Geozee #117 — 784/784 · top 1% 🌍\n🇸🇲🇵🇰🇬🇧🇵🇼🇹🇬🇳🇱🇲🇭🇪🇨🇲🇹\n\n🟩🟩🟨\n🟩🟩🟩\n🟩🟩🟩\n\nhttps://geozee.earth?ref=share",
        expectedSummary: "🟩🟩🟨\n🟩🟩🟩\n🟩🟩🟩\n784/784 · top 1%",
      },
    ],
  },
  {
    ref: "farflung.game",
    title: "Farflung",
    format: block(
      LINES,
      String.raw`
// "Farflung #29 · 195/500 km*\nMiss · Rare · Elusive · Common · Miss" → rarity row, then "195/500 km*"
function format(raw) {
  var ls = lines(raw);
  var header = ls.find(function (l) { return /\d+\/\d+\s*km/.test(l); });
  var score = header ? (header.match(/\d+\/\d+\s*km\*?/) || [])[0] : undefined;
  var row = ls.find(function (l) { return /·/.test(l) && !/\d+\/\d+/.test(l); });
  if (!score) return null;
  return row ? row + "\n" + score : score;
}`,
    ),
    examples: [
      {
        raw: "Farflung #29 · 195/500 km*\nMiss · Rare · Elusive · Common · Miss\nhttps://farflung.game/s/2pqwkd?e=29&w=4",
        expectedSummary: "Miss · Rare · Elusive · Common · Miss\n195/500 km*",
      },
      {
        raw: "Farflung #27 · 155/500 km\nMiss · Miss · Rare · Elusive · Miss\nhttps://farflung.game/s/p4qh34?e=27",
        expectedSummary: "Miss · Miss · Rare · Elusive · Miss\n155/500 km",
      },
    ],
  },
  {
    ref: "magnitudle.com/size-it-up",
    title: "Size It Up",
    format: block(
      LINES,
      String.raw`
// Five "🟥🟥⬜⬜⬜ 43" rows, then the total "257/500". Shares before
// 2026-11-03 say "Overall Score 268" with no denominator; five rounds of 100
// make it /500, so the board reads the same on both sides of the change.
function format(raw) {
  var ls = lines(raw);
  var rounds = ls
    .map(function (l) { return (l.match(/^[🟥⬜]+\s+(\d+)$/u) || [])[1]; })
    .filter(Boolean);
  var total;
  for (var i = 0; i < ls.length && !total; i++) {
    var m = ls[i].match(/^Overall\s+Score\s+([\d,]+)$/i) || ls[i].match(/^Score\s*:\s*([\d,]+\s*\/\s*[\d,]+)$/i);
    if (m) total = m[1].replace(/\s+/g, "");
  }
  if (total && total.indexOf("/") < 0 && rounds.length === 5) total += "/500";
  if (!rounds.length) return total || null;
  return total ? rounds.join(" · ") + "\n" + total : rounds.join(" · ");
}`,
    ),
    examples: [
      {
        raw: "Size It Up\nOverall Score 268\n\n🟥⬜⬜⬜⬜ 19\n🟥🟥⬜⬜⬜ 43\n🟥🟥⬜⬜⬜ 45\n🟥🟥🟥🟥🟥 100\n🟥🟥🟥⬜⬜ 61\nhttps://magnitudle.com/size-it-up",
        expectedSummary: "19 · 43 · 45 · 100 · 61\n268/500",
      },
      {
        raw: "Magnitudle — Size It Up\n2026-11-03\n\nScore: 257/500\n\n🟥🟥🟥🟥⬜ 79\n🟥🟥🟥⬜⬜ 61\n🟥🟥⬜⬜⬜ 47\n🟥🟥🟥⬜⬜ 54\n🟥⬜⬜⬜⬜ 16\nhttps://magnitudle.com/size-it-up",
        expectedSummary: "79 · 61 · 47 · 54 · 16\n257/500",
      },
      {
        // The URL glued to the last round (iOS share sheet) still reads.
        raw: "Magnitudle — Size It Up\n2026-11-03\n\nScore: 209/500\n\n🟥🟥⬜⬜⬜ 35\n⬜⬜⬜⬜⬜ 0\n🟥🟥⬜⬜⬜ 33\n🟥🟥🟥🟥🟥 91\n🟥🟥🟥⬜⬜ 50 https://magnitudle.com/size-it-up",
        expectedSummary: "35 · 0 · 33 · 91 · 50\n209/500",
      },
    ],
  },
  {
    ref: "fermi.gg",
    title: "Fermi",
    format: block(
      LINES,
      String.raw`
// Round errors on one line, then "4.36× · top 49%". The share wraps its URL in <…>.
// Since No. 103 each round carries a marker — ↑/↓ (guessed over/under) or = (exact,
// "02 = 1.00×") — and may end in a free-text comment; keep the marker, drop the
// comment. The marker is matched as any short symbol, so a new one can't drop a round.
function format(raw) {
  var ls = lines(raw);
  var rounds = ls
    .map(function (l) {
      var m = l.match(/^\d{2}\s+(?:([^\s\d]{1,3})\s+)?(\S+×)(?:\s|$)/u);
      return m ? (m[1] || "") + m[2] : undefined;
    })
    .filter(Boolean);
  var total = ls.find(function (l) { return /×\s*score/.test(l); });
  if (!total) return null;
  total = total.replace(/\s*score\s*/, " ").trim();
  return rounds.length ? rounds.join(" · ") + "\n" + total : total;
}`,
    ),
    examples: [
      {
        raw: "Fermi · No. 95\n01  2.47×\n02  4.80×\n03  7.00×\n─────────\n4.36× score · top 49%\n<https://fermi.gg/s/daily>",
        expectedSummary: "2.47× · 4.80× · 7.00×\n4.36× · top 49%",
      },
      {
        raw: "Fermi · No. 97\n01  6,548×\n02  3.33×\n03  23.7×\n─────────\n42.9× score · top 90%\n<https://fermi.gg/s/daily>",
        expectedSummary: "6,548× · 3.33× · 23.7×\n42.9× · top 90%",
      },
      {
        raw: "Fermi · No. 107\n01 ↓ 2.43×\n02 ↑ 2.00×\n03 ↑ 1.07×\n─────────\n1.73× score · top 5%\n<https://fermi.gg/s/daily>",
        expectedSummary: "↓2.43× · ↑2.00× · ↑1.07×\n1.73× · top 5%",
      },
      {
        raw: "Fermi · No. 106\n01 ↓ 16.9× (I forgot how to multiply :( )\n02 ↓ 1.30×\n03 ↓ 1.14×\n─────────\n2.93× score · top 56%\n<https://fermi.gg/s/daily>",
        expectedSummary: "↓16.9× · ↓1.30× · ↓1.14×\n2.93× · top 56%",
      },
      {
        raw: "Fermi · No. 108\n01 ↓ 2.26×\n02 = 1.00×\n03 ↓ 10.6×\n─────────\n2.88× score · top 5%\n<https://fermi.gg/s/daily>",
        expectedSummary: "↓2.26× · =1.00× · ↓10.6×\n2.88× · top 5%",
      },
    ],
  },
  {
    ref: "gerrymandle.com",
    title: "Gerrymandle",
    format: block(
      LINES,
      String.raw`
// "Won the election in 7:47!\n💎🏆 Perfect game" → "7:47 · 💎🏆 Perfect game"
function format(raw) {
  var ls = lines(raw);
  var timeLine = ls.find(function (l) { return /\d+:\d{2}/.test(l); });
  var time = timeLine ? (timeLine.match(/\d+:\d{2}/) || [])[0] : undefined;
  var badge = ls.find(function (l) { return /^[^A-Za-z0-9]/.test(l) && /[A-Za-z]/.test(l); });
  if (!time) return null;
  return badge ? time + " · " + badge : time;
}`,
    ),
    examples: [
      {
        raw: "Gerrymandle #153\nWon the election in 7:47!\n💎🏆 Perfect game\n\nhttps://gerrymandle.com/day/153",
        expectedSummary: "7:47 · 💎🏆 Perfect game",
      },
    ],
  },
  {
    ref: "minutecryptic.com",
    title: "Minute Cryptic",
    format: block(
      LINES,
      String.raw`
// Dot row, then "🏆 0 hints · 2 under par." (solver count dropped), then the bonus line if any.
function format(raw) {
  var ls = lines(raw);
  var dots = ls.find(function (l) { return /^[🟣⚪️⚫️🔵]+$/u.test(l); });
  var hint = ls.find(function (l) { return /\bhints?\b/.test(l); });
  if (hint) {
    hint = hint
      .replace(/\s*\([^)]*\)\s*/g, "")
      .replace(/\s+[–-]\s+/, " · ")
      .replace(/the community par/, "par")
      .trim();
  }
  var bonus = ls.find(function (l) { return /Bonus clues/i.test(l); });
  if (!dots && !hint) return null;
  return [dots, hint, bonus].filter(Boolean).join("\n");
}`,
    ),
    examples: [
      {
        raw: 'Minute Cryptic - 31 October, 2026\n"Old snob rattled and shook tin for a bank deposit?" (5)\n🟣🟣🟣🟣🟣🟣🟣🟣\n🏆 0 hints – 2 under the community par (125,198 solvers so far).\nhttps://www.minutecryptic.com/?utm_source=share\n➕ Bonus clues: solved',
        expectedSummary: "🟣🟣🟣🟣🟣🟣🟣🟣\n🏆 0 hints · 2 under par.\n➕ Bonus clues: solved",
      },
      {
        raw: 'Minute Cryptic - 29 September, 2026\n"Annual migrants?" (5)\n⚪️⚪️🟣🟣🟣🟣🟣🟣\n🤝 2 hints – matched the community par (174,038 solvers so far).\nhttps://www.minutecryptic.com/?utm_source=share',
        expectedSummary: "⚪️⚪️🟣🟣🟣🟣🟣🟣\n🤝 2 hints · matched par.",
      },
    ],
  },
  {
    ref: "timeguessr.com",
    title: "TimeGuessr",
    format: block(
      LINES,
      String.raw`
// Round scores on one line, then the "29,530/50,000" total.
function format(raw) {
  var ls = lines(raw);
  var rounds = ls
    .map(function (l) { return (l.match(/🏆\s*([\d,]+)/) || [])[1]; })
    .filter(Boolean);
  var header = ls.find(function (l) { return /[\d,]+\/[\d,]+/.test(l); });
  var total = header ? (header.match(/[\d,]+\/[\d,]+/) || [])[0] : undefined;
  if (!total) return null;
  return rounds.length ? rounds.join(" · ") + "\n" + total : total;
}`,
    ),
    examples: [
      {
        raw: "TimeGuessr #1245 — 29,530/50,000\n\n1️⃣ 🏆2,947 · 📅 28y · 🌍 999.0mi\n2️⃣ 🏆3,378 · 📅 12y · 🌍 1950.7mi\n3️⃣ 🏆7,283 · 📅 13y · 🌍 2143ft\n4️⃣ 🏆8,000 · 📅 5y · 🌍 321.4mi\n5️⃣ 🏆7,922 · 📅 9y · 🌍 34.3mi\n\nhttps://timeguessr.com",
        expectedSummary: "2,947 · 3,378 · 7,283 · 8,000 · 7,922\n29,530/50,000",
      },
    ],
  },
  {
    ref: "city2city.goldfishwatercooler.com",
    title: "City2City",
    // Route, the per-flight grid, then the time line without its question:
    // "23h 00m · fastest 19h 40m · 3 flights".
    format: block(
      LINES,
      IS_GRID,
      String.raw`
function format(raw) {
  var ls = lines(raw).filter(function (l) { return !/^City2City\b/i.test(l); });
  var route = ls.find(function (l) { return /\bto\b/i.test(l) && !/\d+\s*h\b/i.test(l); });
  var grid = ls.filter(isGrid);
  var timeLine = ls.find(function (l) { return /\d+\s*h\s*\d+\s*m/i.test(l); });
  if (!timeLine) return null;
  var parts = timeLine
    .replace(/\(([^)]*)\)/g, ", $1")
    .split(/\s*,\s*/)
    .map(function (p) { return p.trim(); })
    .filter(Boolean);
  var out = [];
  if (route) out.push(route);
  if (grid.length) out.push(grid.join("\n"));
  out.push(parts.join(" · "));
  return out.join("\n");
}`,
    ),
    examples: [
      {
        raw: "City2City 31\nSan Pedro Sula to Kinshasa\n🟩🟥🟨🟩\n23h 00m (fastest 19h 40m), 3 flights\nCan you beat my time?\nhttps://city2city.goldfishwatercooler.com/?s",
        expectedSummary:
          "San Pedro Sula to Kinshasa\n🟩🟥🟨🟩\n23h 00m · fastest 19h 40m · 3 flights",
      },
      {
        raw: "City2City 32\nOslo to Lima\n🟩🟩\n19h 40m (fastest 19h 40m), 2 flights\nCan you beat my time?",
        expectedSummary: "Oslo to Lima\n🟩🟩\n19h 40m · fastest 19h 40m · 2 flights",
      },
      { raw: "https://city2city.goldfishwatercooler.com/?s", expectedSummary: null },
    ],
  },
  {
    ref: "costcodle.com",
    title: "COSTCODLE",
    // Two modes share this game. Classic folds its tall guess column into one
    // line. Checkout keeps each item's miss but not the item names, which
    // would spoil today's puzzle for a friend who hasn't played.
    format: block(
      LINES,
      String.raw`
function format(raw) {
  if (!/\bCostcodle\b/i.test(raw)) return null;
  var ls = lines(raw);
  var total = raw.match(/walked out\s+(\$\s*[\d,]+(?:\.\d{1,2})?)\s+off the mark/i);
  if (total) {
    var rank = raw.match(/went full\s+([^\r\n]+?)\s+on\b/i);
    var misses = ls
      .map(function (l) { return (l.match(/^\d+\.\s.*\boff\s+(\$[\d,]+(?:\.\d{1,2})?)$/i) || [])[1]; })
      .filter(Boolean);
    var result = ["Checkout", total[1].replace(/\s+/g, "") + " off"];
    if (rank) result.push(rank[1]);
    return (misses.length ? misses.join(" · ") + "\n" : "") + result.join(" · ");
  }
  var header = raw.match(/\bCostcodle\b[^\r\n]*?\s([1-6X])\s*\/\s*6\b/i);
  if (!header) return null;
  var guesses = ls.filter(function (l) { return /^(?:[⬆⬇]️?[🟥🟨🟩]|✅)$/u.test(l); });
  var line = "Classic · " + header[1].toUpperCase() + "/6";
  return guesses.length ? guesses.join(" ") + "\n" + line : line;
}`,
    ),
    examples: [
      {
        raw: "Costcodle Classic #1155 4/6\n⬆️🟥\n⬆️🟥\n⬆️🟨\n✅\n\nPlay now at https://www.costcodle.com",
        expectedSummary: "⬆️🟥 ⬆️🟥 ⬆️🟨 ✅\nClassic · 4/6",
      },
      {
        raw: "Costcodle #1141 3/6\n⬆️🟨\n⬇️🟥\n✅\n\nhttps://costcodle.com/",
        expectedSummary: "⬆️🟨 ⬇️🟥 ✅\nClassic · 3/6",
      },
      {
        raw: "Went full Bulk Buyer on today's Costcodle and walked out $16.50 off the mark!\n\nCostcodle Checkout #10\n1. APPL JUICE — off $1.50\n2. EGG WHITES — off $2.00\n3. PICKLES — off $9.00\n4. IZZE — off $1.00\n5. WHT BREAD — off $3.00\n\nPlay now at https://www.costcodle.com",
        expectedSummary:
          "$1.50 · $2.00 · $9.00 · $1.00 · $3.00\nCheckout · $16.50 off · Bulk Buyer",
      },
      // A hand-typed number stays as typed.
      { raw: "$20.70", expectedSummary: null },
    ],
  },
  {
    ref: "longshots.app",
    title: "LONGSHOTS",
    // Shot grid, then distance, league and percentile. The streak is dropped
    // because HighScore tracks its own.
    format: block(
      LINES,
      String.raw`
function format(raw) {
  var ls = lines(raw);
  var shot;
  for (var i = 0; i < ls.length && !shot; i++) {
    shot = ls[i].match(/⚽\s*([\d,]+)\s*yds\s*·\s*(.+)$/u);
  }
  if (!shot) return null;
  var grid = ls.filter(function (l) { return /^[⬜🟦🟩🟪🟨⬛]+$/u.test(l); });
  var beat = raw.match(/\bbeat\s+(\d+)\s*%/i);
  var stats = [shot[1] + " yds", shot[2].trim()];
  if (beat) stats.push("beat " + beat[1] + "%");
  return grid.concat(stats.join(" · ")).join("\n");
}`,
    ),
    examples: [
      {
        raw: "LONGSHOTS #21 ⚽ 412 yds · Ballon d’Or\n🟨🟪🟪🟨🟩🟦🟪\n🔥 3-day streak · 🧤 2 Keeper’s Goals · Beat 99% of players\nBeat me 👇 https://longshots.app/?beat=412&d=21",
        expectedSummary: "🟨🟪🟪🟨🟩🟦🟪\n412 yds · Ballon d’Or · beat 99%",
      },
      {
        raw: "LONGSHOTS #11 ⚽ 296 yds · Top Flight\n🟩🟪🟪🟦🟦🟪🟪\n🔥 2-day streak · Beat 87% of players\nBeat me 👇 longshots.app",
        expectedSummary: "🟩🟪🟪🟦🟦🟪🟪\n296 yds · Top Flight · beat 87%",
      },
      {
        raw: "LONGSHOTS #18 ⚽ 64 yds · Sunday League\n⬛🟩⬜⬛⬜⬜⬜\n🔥 9-day streak\nBeat me 👇 https://longshots.app/?beat=64&d=18",
        expectedSummary: "⬛🟩⬜⬛⬜⬜⬜\n64 yds · Sunday League",
      },
      {
        raw: "⚽ 201 yds · Championship\n🟦⬜🟪⬜🟪🟪⬜\nBeat 61% of players",
        expectedSummary: "🟦⬜🟪⬜🟪🟪⬜\n201 yds · Championship · beat 61%",
      },
      // Another game's share posted here falls back to its own text.
      {
        raw: "Size It Up\n#102\n\nScore: 209/500\n\n🟥🟥🟥🟥⬜ 70\nhttps://magnitudle.com/size-it-up",
        expectedSummary: null,
      },
    ],
  },
  {
    ref: "headcountgame.com",
    title: "Headcount",
    format: block(
      LINES,
      String.raw`
// "Headcount #30 🏠 · 79 points", a moon row, "beat 84% of the party"
function format(raw) {
  var score = raw.match(/\bHeadcount\s+#\s*[\d,]+[^\r\n]*?·\s*([\d,]+)\s+points\b/i);
  if (!score) return null;
  var moons = lines(raw).filter(function (l) { return /^[🌑🌒🌓🌔🌕]+$/u.test(l); });
  var beat = raw.match(/\bbeat\s+(\d+)\s*%/i);
  var stats = score[1] + " points" + (beat ? " · beat " + beat[1] + "%" : "");
  return moons.concat(stats).join("\n");
}`,
    ),
    examples: [
      {
        raw: "Headcount #30 🏠 · 79 points\n🌔🌔🌔🌓🌔\nbeat 84% of the party\nhttps://headcountgame.com/?vs=Player.79.30.abcde",
        expectedSummary: "🌔🌔🌔🌓🌔\n79 points · beat 84%",
      },
      {
        raw: "Headcount #27 🏠 · 31 points\n🌓🌓🌒🌑🌓\nhttps://headcountgame.com/?vs=Player.31.27.abcde",
        expectedSummary: "🌓🌓🌒🌑🌓\n31 points",
      },
      { raw: "53/100", expectedSummary: null },
    ],
  },
  {
    ref: "playdaily.org/noillirk",
    title: "Noillirk",
    format: block(
      LINES,
      String.raw`
// "Noillirk 🎈 The Daily Climb · No. 52 · 3,613m" + color row → row, then "3,613m"
function format(raw) {
  var climb = raw.match(/\bNoillirk\b[^\r\n]*?·\s*No\.\s*[\d,]+\s*·\s*([\d,]+)\s*m\b/i);
  if (!climb) return null;
  var grid = lines(raw).filter(function (l) { return /^[⬛🟦🟩🟧🟥🟨]+$/u.test(l); });
  return grid.concat(climb[1] + "m").join("\n");
}`,
    ),
    examples: [
      {
        raw: "Noillirk 🎈 The Daily Climb · No. 52 · 3,613m\n\n🟥🟥🟨🟩🟥🟦🟧\n\nClimb today's prompts: https://playdaily.org/noillirk",
        expectedSummary: "🟥🟥🟨🟩🟥🟦🟧\n3,613m",
      },
      { raw: "5,713m", expectedSummary: null },
    ],
  },
  {
    ref: "moonshotdailygame.com",
    title: "Moonshot",
    // Result rows, then where it landed. Both missions share this game: Common
    // vs Blue Moon (👥 rows) and The Ladder (✅🔸🔻❌ rows, plus a bullseye count).
    // Daily player counts swing from about 2k to 20k, so a rank reads as a
    // percentile to compare across days.
    format: block(
      LINES,
      String.raw`
function format(raw) {
  var ls = lines(raw);
  var stats;
  for (var i = 0; i < ls.length && !stats; i++) {
    stats = ls[i].match(/^([\d,]+)\s+pts\b(.*)$/i);
  }
  if (!stats) return null;
  var rows = ls.filter(function (l) { return /^👥/u.test(l) || /^[✅🔸🔻❌]+$/u.test(l); });
  var landed = raw.match(/Landed:\s*([^\r\n]+)/i);
  var parts = [];
  if (landed) parts.push("🚀 " + landed[1].trim());
  else if (/Teleported/i.test(raw)) parts.push("🌀 Blue Moon");
  parts.push(stats[1] + " pts");
  var bullseyes = stats[2].match(/(\d+\/\d+)\s+bullseyes/i);
  if (bullseyes) parts.push(bullseyes[1] + " bullseyes");
  var ranked = stats[2].match(/#([\d,]+)\s+of\s+([\d,]+)/);
  var top = stats[2].match(/\btop\s+(\d+)%/i);
  if (ranked) {
    var rank = Number(ranked[1].replace(/,/g, ""));
    var field = Number(ranked[2].replace(/,/g, ""));
    if (rank > 0 && field >= rank) parts.push("top " + Math.ceil((rank / field) * 100) + "%");
  } else if (top) {
    parts.push("top " + top[1] + "%");
  }
  return rows.concat(parts.join(" · ")).join("\n");
}`,
    ),
    examples: [
      {
        raw: "MOONSHOT CR-060 · The Ladder\n✅🔸🔻❌\n🚀 Landed: Saturn\n240 pts · 1/4 bullseyes · top 20%\nBeat my 240: https://moonshotdailygame.com/?beat=240&m=l&d=2026-11-22",
        expectedSummary: "✅🔸🔻❌\n🚀 Saturn · 240 pts · 1/4 bullseyes · top 20%",
      },
      {
        raw: "MOONSHOT CR-061 · Common vs Blue Moon\n👥 🥇🥈🥉  🌕 💙💙💙\n🌀 Teleported to the Blue Moon\n1500 pts · top 1% · streak 9",
        expectedSummary: "👥 🥇🥈🥉  🌕 💙💙💙\n🌀 Blue Moon · 1500 pts · top 1%",
      },
      {
        raw: "MOONSHOT CR-054 · Common vs Blue Moon\n👥 🥈🥇🟫  🌕 🩷🟩🩷\n👥 🥈🥉🟫  🌕 🩷🩷🩷\n🚀 Landed: Pluto\n863 pts · #11835 of 20403 · streak 1\nBeat my 863: https://moonshotdailygame.com/?beat=863&m=g&d=2026-11-16",
        expectedSummary: "👥 🥈🥇🟫  🌕 🩷🟩🩷\n👥 🥈🥉🟫  🌕 🩷🩷🩷\n🚀 Pluto · 863 pts · top 59%",
      },
      {
        raw: "MOONSHOT CR-056 · Common vs Blue Moon\n👥 🟫🥉🥈  🌕 🟪🟩🟪\n👥 🥇🥈🟧  🌕 🟩🟩🟩\n🚀 Landed: Uranus\n639 pts · #961 of 2635 · streak 3\nBeat my 639: https://moonshotdailygame.com/?beat=639&m=g&d=2026-11-18",
        expectedSummary:
          "👥 🟫🥉🥈  🌕 🟪🟩🟪\n👥 🥇🥈🟧  🌕 🟩🟩🟩\n🚀 Uranus · 639 pts · top 37%",
      },
      { raw: "642", expectedSummary: null },
    ],
  },
  {
    ref: "canucklegame.ca",
    title: "Canuckle",
    format: block(
      LINES,
      String.raw`
// Wordle-shaped: the guess grid is the result, the streak line is dropped.
function format(raw) {
  if (!/\bCanuckle\b/i.test(raw)) return null;
  var grid = lines(raw).filter(function (l) { return /^[⬜⬛🟨🟥🟩]+$/u.test(l); });
  return grid.length ? grid.join("\n") : null;
}`,
    ),
    examples: [
      {
        raw: "🍁 Canuckle 1634 4/6\n\n⬜⬜🟨⬜⬜\n⬜🟨⬜⬜⬜\n⬜🟥🟨⬜🟨\n🟥🟥🟥🟥🟥\n\n🔥 Streak: 1\n\ncanucklegame.ca",
        expectedSummary: "⬜⬜🟨⬜⬜\n⬜🟨⬜⬜⬜\n⬜🟥🟨⬜🟨\n🟥🟥🟥🟥🟥",
      },
    ],
  },
  {
    ref: "playplain.app/play",
    title: "Plain",
    // The game ships in 18 languages. Thousands may be grouped with a space,
    // dot or apostrophe ("6 651 m", "6.651 m"); all render as "6,651 m". The grid
    // matches only the tier emoji, because a translated line in a non-Latin
    // script has no ASCII letters and would otherwise read as a grid row.
    format: block(
      LINES,
      String.raw`
function format(raw) {
  var ls = lines(raw);
  var flight;
  for (var i = 0; i < ls.length && !flight; i++) {
    flight = ls[i].match(/^Plain\b.*?✈️?\s*(\d(?:[\d.,'\s]*\d)?)\s*m$/iu);
  }
  if (!flight) return null;
  var grid = ls.filter(function (l) { return /^[🎯🟩🟨🟧🟥]+$/u.test(l); });
  var top = raw.match(/\btop\s*(\d+)\s*%/i);
  var meters = flight[1].replace(/[.,'\s]+/g, ",");
  return grid.concat(meters + " m" + (top ? " · top " + top[1] + "%" : "")).join("\n");
}`,
    ),
    examples: [
      {
        raw: "Plain #40 ✈️ 6.651 m\n🎯🟩🟧🟨🟨🎯🟨\nTop 3 % heute · 🔥 5-Tage-Serie\nhttps://playplain.app/c/ABC123",
        expectedSummary: "🎯🟩🟧🟨🟨🎯🟨\n6,651 m · top 3%",
      },
      {
        raw: "Plain #40 ✈️ 3,832 m\n🟥🟩🟩🟧🟧🟨🟥\n你能赢我吗？👇\nhttps://playplain.app/c/ABC123",
        expectedSummary: "🟥🟩🟩🟧🟧🟨🟥\n3,832 m",
      },
      {
        raw: "Plain #32 ✈️ 3,832 m\n🟥🟩🟩🟧🟧🟨🟥\n🔥 4-day streak\nCan you beat me? 👇\nhttps://playplain.app/c/ABC123",
        expectedSummary: "🟥🟩🟩🟧🟧🟨🟥\n3,832 m",
      },
      {
        raw: "Plain #30 ✈️ 6 651 m\n🎯🎯🟧🟨🟨🎯🟨\nTop 3 % aujourd’hui\nTu peux faire mieux ? 👇\nhttps://playplain.app/c/ABC123",
        expectedSummary: "🎯🎯🟧🟨🟨🎯🟨\n6,651 m · top 3%",
      },
      { raw: "4695", expectedSummary: null },
    ],
  },
];
