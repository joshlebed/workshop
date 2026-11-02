import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORMAT_CONTRACT,
  FORMAT_CONTRACT_SECTION,
  PARSE_CONTRACT,
  PARSE_CONTRACT_SECTIONS,
} from "./contract.js";

describe("PARSE_CONTRACT", () => {
  it("is a verbatim copy of the README sections the teach prompt is written from", () => {
    const readme = readFileSync(new URL("../gameCode/README.md", import.meta.url), "utf8");
    const copied = PARSE_CONTRACT_SECTIONS.map(([start, end]) => {
      const from = readme.indexOf(start);
      const to = readme.indexOf(end, from);
      expect(from, `README lost the heading ${start}`).toBeGreaterThanOrEqual(0);
      expect(to, `README lost the heading ${end}`).toBeGreaterThan(from);
      return readme.slice(from, to).trim();
    }).join("\n\n");
    expect(PARSE_CONTRACT).toBe(copied);
  });

  it("carries the thousands-separator hint the codegen benchmark depends on", () => {
    expect(PARSE_CONTRACT).toContain("thousands separators");
  });
});

describe("FORMAT_CONTRACT", () => {
  it("is a verbatim copy of the README's format section", () => {
    const readme = readFileSync(new URL("../gameCode/README.md", import.meta.url), "utf8");
    const [start, end] = FORMAT_CONTRACT_SECTION;
    const from = readme.indexOf(start);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(FORMAT_CONTRACT).toBe(readme.slice(from, readme.indexOf(end, from)).trim());
  });
});
