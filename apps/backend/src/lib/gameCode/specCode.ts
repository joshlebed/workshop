// Turns a taught spec (the declarative `ScoreSpec` / `SummarySpec` DSLs from
// `@workshop/shared`) into stored code: `var SPEC = <the spec as JSON>;`
// followed by a small interpreter that satisfies the stored-code contract
// (README.md). Games taught through the tap-the-score flow get their code
// this way, so every game — registry or taught — runs through the same
// sandbox.
//
// The output shape is deliberately "one data line + a fixed interpreter": the
// seed migration builds the very same text in SQL
// (`'var SPEC = ' || score_spec::text || …`), which is how specs taught
// before this existed were converted. `seed.test.ts` holds the two together.
//
// Differences from `evaluateScoreSpec`, both on purpose:
//   - No "first number in the text" fallback. A share no rule matches throws,
//     and is stored as `failed`.
//   - A `tokenPosition` rule whose grid is present but has no winning token
//     returns `null` — that is the DSL's own definition of a loss.

import type { ScoreSpec } from "@workshop/shared/scoreParsing";
import type { SummarySpec } from "@workshop/shared/summarySpec";

export const SPEC_CODE_PREFIX = "var SPEC = ";

/** The interpreter for a `ScoreSpec` held in `SPEC`. Mirrors `evaluateRule`. */
export const SCORE_SPEC_INTERPRETER = String.raw`
// Generated from a taught score rule. SPEC (above) is the rule list; this
// reads it. First rule that yields a number wins.
var LOSS = {};

function toNumber(text) {
  var n = Number(String(text).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function regex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    return null;
  }
}

function evaluate(rule, raw) {
  var re, m;
  if (rule.kind === "capture") {
    re = regex(rule.pattern, "i");
    m = re && raw.match(re);
    if (!m) return null;
    return toNumber(m[1] === undefined || m[1] === null ? m[0] : m[1]);
  }
  if (rule.kind === "count") {
    if (rule.within !== undefined && rule.within !== null) {
      re = regex(rule.within, "u");
      if (!re || !re.test(raw)) return null;
    }
    return rule.token.length === 0 ? 0 : raw.split(rule.token).length - 1;
  }
  if (rule.kind === "countLines") {
    re = regex(rule.pattern, "u");
    if (!re) return null;
    var lines = raw.split(/\r?\n/).filter(function (l) { return re.test(l.trim()); }).length;
    return lines > 0 ? lines : null;
  }
  if (rule.kind === "duration") {
    re = regex(rule.pattern || "(?:(\\d+):)?(\\d+):(\\d{2})", "");
    m = re && raw.match(re);
    if (!m) return null;
    var parts = m.slice(1).filter(function (g) { return g !== undefined; }).map(Number);
    if (parts.length < 2 || parts.some(function (n) { return !isFinite(n); })) return null;
    parts.reverse();
    return (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
  }
  if (rule.kind === "tokenPosition") {
    var tokens = [rule.token].concat(rule.among).filter(function (t) { return t.length > 0; });
    var position = 0;
    var cursor = 0;
    while (cursor < raw.length) {
      var earliest = -1;
      var found = "";
      for (var i = 0; i < tokens.length; i++) {
        var at = raw.indexOf(tokens[i], cursor);
        if (at !== -1 && (earliest === -1 || at < earliest)) {
          earliest = at;
          found = tokens[i];
        }
      }
      if (earliest === -1) break;
      position += 1;
      if (found === rule.token) return position;
      cursor = earliest + found.length;
    }
    // Squares but no winning one: a loss, not an unreadable share.
    return position > 0 ? LOSS : null;
  }
  if (rule.kind === "wordMap") {
    re = regex(rule.pattern, "i");
    m = re && raw.match(re);
    if (!m || !m[1]) return null;
    var wanted = m[1].trim().toLowerCase().replace(/\s+/g, " ");
    var keys = Object.keys(rule.map);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].trim().toLowerCase().replace(/\s+/g, " ") === wanted) return rule.map[keys[k]];
    }
    return null;
  }
  return null;
}

function parse(raw) {
  var lost = false;
  for (var i = 0; i < SPEC.rules.length; i++) {
    var value = evaluate(SPEC.rules[i], raw);
    if (typeof value === "number") return value;
    if (value === LOSS) lost = true;
  }
  if (lost) return null;
  throw new Error("no rule matched this share");
}
`.trimStart();

/** The interpreter for a `SummarySpec` held in `SPEC`. Mirrors `evaluateSummarySpec`. */
export const SUMMARY_SPEC_INTERPRETER = String.raw`
// Generated from a taught recap rule. SPEC (above) lists the line patterns to
// keep. URLs, blank lines and hashtag-only lines are dropped first; a share
// with no matching line shows the cleaned raw text instead.
function format(raw) {
  var regexes = [];
  for (var i = 0; i < SPEC.rules.length; i++) {
    try {
      regexes.push(new RegExp(SPEC.rules[i].pattern, "u"));
    } catch (e) {}
  }
  if (regexes.length === 0) return null;
  var kept = raw
    .split(/\r?\n/)
    .map(function (l) { return l.replace(/\bhttps?:\/\/\S+/gi, "").trimEnd(); })
    .filter(function (l) { return l.trim().length > 0 && !/^\s*#\S+\s*$/.test(l); })
    .filter(function (l) { return regexes.some(function (re) { return re.test(l.trim()); }); });
  return kept.length > 0 ? kept.join("\n") : null;
}
`.trimStart();

function withSpec(spec: unknown, interpreter: string): string {
  return `${SPEC_CODE_PREFIX}${JSON.stringify(spec)};\n${interpreter}`;
}

/** Stored `parse_code` for a taught `ScoreSpec`. */
export function compileScoreSpec(spec: ScoreSpec): string {
  return withSpec(spec, SCORE_SPEC_INTERPRETER);
}

/** Stored `format_code` for a taught `SummarySpec`. */
export function compileSummarySpec(spec: SummarySpec): string {
  return withSpec(spec, SUMMARY_SPEC_INTERPRETER);
}
