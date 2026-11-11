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
];
