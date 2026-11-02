// PROTOTYPE — generated share formatters. The two flags (`GAME_TEACH_FORMAT`,
// `GAME_FORMATTER_PREVIEW`, both `off` by default and not in Terraform) and the
// gate an LLM-written `format(raw)` must pass before anything stores it.

import { getConfig } from "../config.js";
import { runFormat, validateCode } from "../gameCode/runtime.js";
import { teachModeFor } from "./gate.js";

/** The longest summary a generated formatter may produce on the teaching example. */
const MAX_GENERATED_SUMMARY_LINES = 6;

/** Whether teach's write-code call also writes `format(raw)`. Global, no beta override. */
export function teachFormatOn(): boolean {
  return getConfig().gameTeachFormat === "on";
}

/**
 * Whether the paste sheet's "Summary preview" card is offered to this caller
 * (`capabilities.formatterPreview`). Needs teach on as well: the card sits in
 * teach v2's paste sheet. Unlike teach there is no beta-account override, so
 * this is off everywhere until the flag is set.
 */
export function formatterPreviewOn(userId: string): boolean {
  return getConfig().gameFormatterPreview === "on" && teachModeFor(userId) === "on";
}

type FormatGateResult =
  | { ok: true }
  | {
      ok: false;
      /** `unavailable` = the sandbox could not run it; says nothing about the code. */
      reason: "unavailable" | "invalid" | "blank_on_example" | "too_many_lines";
      detail?: string;
    };

/**
 * Gate one generated formatter through the real sandbox: it must load, must
 * not fail on any example, must render the teaching example to something,
 * and that something must be at most six lines.
 */
export async function gateGeneratedFormat(input: {
  format: string;
  /** The share it was written from. */
  teachingRaw: string;
  /** Other shares of the game it must not fail on. */
  otherRaws?: readonly string[];
}): Promise<FormatGateResult> {
  const raws = [input.teachingRaw, ...(input.otherRaws ?? [])];
  // `validateCode` needs a parse block; this one only has to load.
  const report = await validateCode(
    { parse: "function parse(raw) { return null; }", format: input.format },
    raws.map((raw) => ({ raw })),
  );
  if (report.unavailable) return { ok: false, reason: "unavailable" };
  if (!report.ok) {
    return {
      ok: false,
      reason: "invalid",
      detail: report.mismatches.map((m) => JSON.stringify(m)).join("; "),
    };
  }
  const own = await runFormat(input.format, input.teachingRaw);
  if (own.kind === "failed") {
    return own.reason === "sandbox_unavailable"
      ? { ok: false, reason: "unavailable" }
      : { ok: false, reason: "invalid", detail: own.reason };
  }
  if (own.kind === "none") return { ok: false, reason: "blank_on_example" };
  const lines = own.text.split(/\r?\n/).length;
  if (lines > MAX_GENERATED_SUMMARY_LINES) {
    return { ok: false, reason: "too_many_lines", detail: `${lines} lines` };
  }
  return { ok: true };
}
