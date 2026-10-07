// The alteration test's inputs: given a share and the feature a user picked
// as the score, produce near-copies of the share in which that feature has a
// different value. Code that really reads the feature follows the change;
// code that memorised the example (a constant, an anchor on the wrong number)
// does not. Mutations keep the share's structure — a digit is swapped for a
// digit, a grid cell for a grid cell — so a strict but correct parser is not
// failed for something no real share would contain.

import {
  findScoreFeature,
  gridLines,
  type ScoreFeature,
  symbolSpans,
} from "@workshop/shared/scoreCandidates";

interface Alteration {
  raw: string;
  /** The picked feature's value in `raw` — what the code must now return. */
  expected: number;
  /** What was changed, for logs and model feedback. */
  how: string;
}

function replaceAt(raw: string, start: number, end: number, text: string): string {
  return raw.slice(0, start) + text + raw.slice(end);
}

/** Nudge a digit without leaving the range a share would use (`6/6` → `5/6`, `1/6` → `2/6`). */
function nudgeDigit(digit: string): string {
  const d = Number(digit);
  return String(d >= 2 ? d - 1 : d + 1);
}

function alterLiteral(raw: string, feature: ScoreFeature): Alteration[] {
  if (feature.text === null || feature.start === null) return [];
  // A fraction's value is its left side; everything else ends in its value.
  const slash = feature.kind === "fraction" ? feature.text.indexOf("/") : -1;
  const valuePart = slash === -1 ? feature.text : feature.text.slice(0, slash);
  let at = -1;
  for (let i = valuePart.length - 1; i >= 0; i--) {
    if (/\d/.test(valuePart[i] as string)) {
      at = i;
      break;
    }
  }
  if (at === -1) return [];
  const index = feature.start + at;
  const altered = replaceAt(raw, index, index + 1, nudgeDigit(raw[index] as string));
  const after = findScoreFeature(altered, feature.id);
  if (!after || after.value === feature.value) return [];
  return [{ raw: altered, expected: after.value, how: `changed ${feature.text} to ${after.text}` }];
}

interface GridCell {
  start: number;
  end: number;
  symbol: string;
}

function gridCells(raw: string): GridCell[] {
  return gridLines(raw).flatMap((line) =>
    symbolSpans(line.text).map((span) => ({
      start: line.start + span.start,
      end: line.start + span.end,
      symbol: span.symbol,
    })),
  );
}

function alterCount(raw: string, feature: ScoreFeature): Alteration[] {
  const symbol = feature.symbol;
  if (symbol === null) return [];
  const lines = gridLines(raw);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    // No grid: the tally is over the whole text, so repeat the symbol in place.
    const first = symbolSpans(raw).find((span) => span.symbol === symbol);
    if (!first) return [];
    const altered = replaceAt(raw, first.end, first.end, raw.slice(first.start, first.end));
    const expected = findScoreFeature(altered, feature.id)?.value;
    if (expected === undefined || expected === feature.value) return [];
    return [{ raw: altered, expected, how: `one more ${symbol}` }];
  }
  const cells = gridCells(raw);
  const mine = cells.filter((c) => c.symbol === symbol);
  const others = cells.filter((c) => c.symbol !== symbol);
  // Write the symbol the way the share writes it (it may carry a variation selector).
  const written = mine[0] ? raw.slice(mine[0].start, mine[0].end) : symbol;
  const valueIn = (text: string) =>
    findScoreFeature(text, feature.id, { knownSymbols: [symbol] })?.value;

  const out: Alteration[] = [];
  const push = (altered: string, how: string) => {
    const expected = valueIn(altered);
    if (expected !== undefined && expected !== feature.value) {
      out.push({ raw: altered, expected, how });
    }
  };
  // One more: turn another cell into the symbol, or append one to the grid.
  const other = others[0];
  if (other) push(replaceAt(raw, other.start, other.end, written), `one more ${symbol}`);
  else {
    const end = lastLine.start + lastLine.text.length;
    push(replaceAt(raw, end, end, written), `one more ${symbol}`);
  }
  // One fewer: turn one of the symbol's cells into another, or drop it.
  const first = mine[0];
  if (first && other) {
    const otherWritten = raw.slice(other.start, other.end);
    push(replaceAt(raw, first.start, first.end, otherWritten), `one fewer ${symbol}`);
  } else if (first && mine.length >= 2) {
    push(replaceAt(raw, first.start, first.end, ""), `one fewer ${symbol}`);
  }
  return out;
}

function alterRows(raw: string, feature: ScoreFeature): Alteration[] {
  const lines = gridLines(raw);
  const last = lines[lines.length - 1];
  if (!last) return [];
  const out: Alteration[] = [];
  const push = (altered: string, how: string) => {
    const expected = findScoreFeature(altered, feature.id)?.value;
    if (expected !== undefined && expected !== feature.value) {
      out.push({ raw: altered, expected, how });
    }
  };
  const end = last.start + last.text.length;
  push(replaceAt(raw, end, end, `\n${last.text}`), "one more row");
  // Dropping a row from a two-row grid leaves no row count to compare with.
  if (lines.length >= 3) {
    const lineEnd = raw[end] === "\r" ? end + 2 : end + 1;
    push(replaceAt(raw, last.start, Math.min(lineEnd, raw.length), ""), "one fewer row");
  }
  return out;
}

function alterPosition(raw: string, feature: ScoreFeature): Alteration[] {
  const cells = gridCells(raw);
  const index = cells.findIndex((c) => c.symbol === feature.symbol);
  const cell = cells[index];
  const neighbour = cells[index - 1] ?? cells[index + 1];
  if (!cell || !neighbour) return [];
  const [left, right] = neighbour.start < cell.start ? [neighbour, cell] : [cell, neighbour];
  const altered =
    raw.slice(0, left.start) +
    raw.slice(right.start, right.end) +
    raw.slice(left.end, right.start) +
    raw.slice(left.start, left.end) +
    raw.slice(right.end);
  const expected = findScoreFeature(altered, feature.id)?.value;
  if (expected === undefined || expected === feature.value) return [];
  return [{ raw: altered, expected, how: `moved ${feature.symbol}` }];
}

/**
 * Near-copies of `raw` in which the picked feature's value differs. Empty
 * when the share offers nothing to alter safely — the caller then has no
 * alteration evidence for this example and must not treat that as a pass.
 */
export function alterationsFor(raw: string, feature: ScoreFeature): Alteration[] {
  switch (feature.kind) {
    case "symbolCount":
      return alterCount(raw, feature);
    case "rowCount":
      return alterRows(raw, feature);
    case "position":
      return alterPosition(raw, feature);
    default:
      return alterLiteral(raw, feature);
  }
}

const URL_SPANS = /\bhttps?:\/\/\S+/gi;

/**
 * The same test for an "I didn't finish" pick: a copy of the share with its
 * multi-digit numbers (puzzle number, date) nudged must still be a loss.
 * Catches code that returns null because it recognised this one share. Single
 * digits are left alone — the 6 in `X/6` is part of the loss shape itself.
 * Null when the share has no such number to nudge.
 */
export function noResultAlteration(raw: string): string | null {
  const urls = [...raw.matchAll(URL_SPANS)].map((m) => [m.index, m.index + m[0].length] as const);
  let changed = false;
  const altered = raw.replace(/\d{2,}/g, (run, offset: number) => {
    if (urls.some(([start, end]) => offset >= start && offset < end)) return run;
    changed = true;
    return run.slice(0, -1) + nudgeDigit(run.slice(-1));
  });
  return changed ? altered : null;
}
