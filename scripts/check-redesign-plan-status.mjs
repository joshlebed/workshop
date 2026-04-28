#!/usr/bin/env node
// Verify docs/redesign-plan.md's chunks tables agree with the prose at the
// top ("Current status" → Done / Next to implement). Catches the drift
// class where a hand-edit flips a Status cell but forgets the prose pointer
// (or vice versa). The chunk identifier (e.g. 0a, 1b-2, 4a-2) is the join
// key.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const planPath = join(__dirname, "..", "docs", "redesign-plan.md");
const src = readFileSync(planPath, "utf8");

// Chunk IDs used in this plan: 0a, 0b-1, 1b-2, 4a-2, 5a, … —
// single digit, single lowercase letter [a-f], optional `-<digit>`.
const CHUNK_RE = /\b\d[a-f](?:-\d)?\b/g;

// Pull every chunks-table row. Split cells on pipes that aren't escaped
// (rows include `movie\|tv` which is an escaped pipe inside backticks); the
// last non-empty cell is the Status. Both `**Done**` and plain `Done` are
// observed.
const tableStatus = new Map();
for (const line of src.split("\n")) {
  const headMatch = line.match(/^\|\s+\*\*(\d[a-f](?:-\d)?)\*\*\s+\|/);
  if (!headMatch) continue;
  const cells = line
    .split(/(?<!\\)\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const last = cells[cells.length - 1] ?? "";
  const statusWord = last.replace(/^\*\*/, "").match(/^[A-Za-z]+/);
  if (statusWord) tableStatus.set(headMatch[1], statusWord[0]);
}

// Slice a section bounded by its `### <heading>` and the next `###`/`##`.
function sectionBody(heading) {
  const re = new RegExp(`^### ${heading}\\b\\n([\\s\\S]*?)(?=^### |^## )`, "m");
  const match = src.match(re);
  return match ? match[1] : "";
}

const errors = [];

// 1. Every chunk named in the Done prose must have a Done table row.
const doneChunks = new Set(sectionBody("Done").match(CHUNK_RE) ?? []);
for (const chunk of doneChunks) {
  const status = tableStatus.get(chunk);
  if (!status) {
    errors.push(`"Done" mentions ${chunk} but no §3.x table row has it`);
  } else if (status !== "Done") {
    errors.push(`"Done" mentions ${chunk} but its table Status is "${status}" (expected "Done")`);
  }
}

// 2. Next to implement: the **bolded** chunk target must be Pending.
const nextBody = sectionBody("Next to implement");
const nextMatch = nextBody.match(/\*\*(\d[a-f](?:-\d)?)\b/);
if (!nextMatch) {
  errors.push(`"Next to implement" prose doesn't bold any chunk id`);
} else {
  const chunk = nextMatch[1];
  const status = tableStatus.get(chunk);
  if (!status) {
    errors.push(`"Next to implement" names ${chunk} but no §3.x table row has it`);
  } else if (status !== "Pending") {
    errors.push(
      `"Next to implement" names ${chunk} but its table Status is "${status}" (expected "Pending")`,
    );
  }
}

if (errors.length > 0) {
  console.error("redesign-plan status check failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(
  `redesign-plan status OK (${tableStatus.size} chunk rows; Done + Next to implement prose agrees with tables)`,
);
