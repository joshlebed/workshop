// PROTOTYPE — the layer-1 heuristic formatter (`@workshop/shared/formatHeuristic`)
// as a stored `format(raw)` block, so "Looks good" in HighScore's formatter
// preview can install it as a game's `format_code`.
//
// The block is built from the shared functions' own source (`String(fn)`), so
// what the paste sheet previews and what the sandbox runs are the same code;
// `heuristicFormat.test.ts` pins that they agree in QuickJS.
//
// A format block never sees the parse block, but the heuristic wants the line
// the score came from. So the game's parse code is embedded in the block and
// called first. Trade-off (fine for a prototype, wrong for production): a
// later re-teach of `parse` does not reach the copy embedded here.

import { findScoreLine, formatShareBodyHeuristic } from "@workshop/shared/formatHeuristic";
import { MAX_CODE_CHARS } from "./limits.js";

const FORMAT_FN = `
function format(raw) {
  var value = null;
  if (typeof parse === "function") {
    try {
      var v = parse(raw);
      if (typeof v === "number" && isFinite(v)) value = v;
    } catch (e) {}
  }
  var line = value === null ? null : __findScoreLine(raw, value);
  return __formatShareBodyHeuristic(raw, { title: __HEURISTIC_TITLE, scoreLine: line });
}`;

interface HeuristicFns {
  formatShareBodyHeuristic: (...args: never[]) => unknown;
  findScoreLine: (...args: never[]) => unknown;
}

/** The stored block for one game. `parseCode` is embedded when it fits. */
export function heuristicFormatCode(input: { title: string; parseCode: string | null }): string {
  return heuristicFormatCodeFrom({ formatShareBodyHeuristic, findScoreLine }, input);
}

/**
 * Build the block from a given compilation of the shared functions. A
 * compiler with keep-names on (tsx, esbuild `keepNames`) wraps inner
 * functions in `__name(fn, "name")`, which `String(fn)` carries along, so the
 * block defines a no-op `__name`. Exported so the test can build from a
 * keep-names compilation.
 */
export function heuristicFormatCodeFrom(
  fns: HeuristicFns,
  input: { title: string; parseCode: string | null },
): string {
  const lib = [
    "// PROTOTYPE heuristic formatter, generated from @workshop/shared/formatHeuristic.",
    "var __name = function (fn) { return fn; };",
    `var __HEURISTIC_TITLE = ${JSON.stringify(input.title)};`,
    `var __formatShareBodyHeuristic = (${String(fns.formatShareBodyHeuristic)});`,
    `var __findScoreLine = (${String(fns.findScoreLine)});`,
    FORMAT_FN.trim(),
  ].join("\n\n");
  const parse = input.parseCode?.trim();
  if (!parse) return `${lib}\n`;
  const withParse = `${parse}\n\n${lib}\n`;
  return withParse.length <= MAX_CODE_CHARS ? withParse : `${lib}\n`;
}
