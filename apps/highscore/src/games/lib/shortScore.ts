// One-token score for the scoreboard card and the 7-day strips.
//
// The server gives a numeric `scoreValue` and a multi-line recap
// `scoreSummary`; neither fits a podium cell. This keeps the human-shaped
// token when the recap carries one ("5/6", "+1", "0:45") and falls back to the
// number. Ordering is never derived from it — the server's `rank` is the only
// sort key anywhere in the app.

import type { ScoreCodeFields } from "@workshop/shared/games";

export interface ShortScoreInput extends ScoreCodeFields {
  scoreValue: number | null;
  scoreRaw: string | null;
}

/** Fold keycap emoji ("4️⃣") back into digits so "0️⃣:4️⃣5️⃣" reads "0:45". */
function foldKeycaps(text: string): string {
  return text.replace(/([0-9#*])️?⃣/g, "$1");
}

/** A fraction like "5/6" ("6/6*" → "6/6", "676/798") anywhere in the text. */
function fraction(text: string): string | null {
  const m = /(?:^|\s)(X|\d{1,4})\/(\d{1,4})\*?(?=\s|$)/u.exec(text);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Letters, digits and the punctuation a score token can carry — no emoji, no
// flags (regional indicators are not Extended_Pictographic, so test the
// allow-list rather than the emoji class).
const PLAIN_TOKEN = /^[\p{L}\p{N}+\-:.%']+$/u;

export function shortScore(entry: ShortScoreInput): string {
  if (entry.parseStatus === "no_result") return "✗";
  if (entry.parseStatus === "failed") return "?";
  const summary = foldKeycaps(entry.scoreSummary ?? "").trim();
  if (summary) {
    const frac = fraction(summary);
    if (frac) return frac;
    const lines = summary
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    // "Final score: 902" → "902"; "✅🟧✅✅ +1" → "+1"; "= 7" → "7".
    const tokens = last.split(/\s+/).filter((t) => t !== "=");
    const tail = tokens[tokens.length - 1] ?? "";
    if (PLAIN_TOKEN.test(tail) && Array.from(tail).length <= 6) return tail;
  }
  if (entry.scoreValue != null && Number.isFinite(entry.scoreValue)) {
    return formatNumber(entry.scoreValue);
  }
  return summary ? "✓" : "—";
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

/** "1ST" / "2ND" / "3RD" / "11TH" — pixel-caps ordinal for a rank. */
export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}TH`;
  switch (rank % 10) {
    case 1:
      return `${rank}ST`;
    case 2:
      return `${rank}ND`;
    case 3:
      return `${rank}RD`;
    default:
      return `${rank}TH`;
  }
}
