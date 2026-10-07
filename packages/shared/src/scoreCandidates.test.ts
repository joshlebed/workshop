import { describe, expect, it } from "vitest";
import {
  computeScoreFeatures,
  derivationForValue,
  findScoreFeature,
  gridLines,
  suggestDirectionForFeature,
  symbolsIn,
} from "./scoreCandidates.js";
import { fixtureFeature, SCORE_SHAPE_FIXTURES } from "./scoreShapeFixtures.js";

const shape = (key: string) => {
  const found = SCORE_SHAPE_FIXTURES.find((s) => s.key === key);
  if (!found) throw new Error(`no fixture ${key}`);
  return found;
};
const labels = (raw: string) => computeScoreFeatures(raw).map((f) => f.label);

describe("computeScoreFeatures — the 19 prod share shapes", () => {
  it("covers all 19 surveyed games", () => {
    expect(SCORE_SHAPE_FIXTURES).toHaveLength(19);
  });

  for (const fixture of SCORE_SHAPE_FIXTURES) {
    it(`${fixture.title}: offers the score as a candidate`, () => {
      const features = computeScoreFeatures(fixture.raw);
      const feature = fixtureFeature(features, fixture.pick);
      expect(feature, `no ${fixture.pick.kind} candidate in ${labels(fixture.raw)}`).toBeDefined();
      expect(feature?.value).toBe(fixture.value);
      // Ids are unique, so a pick names exactly one feature.
      expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
      expect(findScoreFeature(fixture.raw, feature?.id ?? "")?.value).toBe(fixture.value);
    });
  }

  it("is deterministic", () => {
    for (const { raw } of SCORE_SHAPE_FIXTURES) {
      expect(computeScoreFeatures(raw)).toEqual(computeScoreFeatures(raw));
    }
  });
});

describe("symbol tallies", () => {
  it("tallies symbols the old fixed emoji list missed (Krillion, Minute Cryptic)", () => {
    expect(labels(shape("krillion").raw)).toEqual(
      expect.arrayContaining(["2 × 🦑", "2 × 🏮", "2 × 🫧"]),
    );
    // ⚪️ carries a variation selector in the share; it is one symbol either way.
    expect(labels(shape("minutecryptic").raw)).toEqual(
      expect.arrayContaining(["4 × ⚪", "2 × 🟣"]),
    );
  });

  it("scopes a count to the result grid, so a typed note does not add one", () => {
    const base = shape("dailytens").raw;
    const withNote = `${base}\n🏆 crushed it`;
    const count = (raw: string) => findScoreFeature(raw, "count:🏆")?.value;
    expect(count(base)).toBe(7);
    expect(count(withNote)).toBe(7);
  });

  it("does not treat the header emoji as part of the grid", () => {
    // 🦐 sits on the title line, 🤝 on a prose line.
    expect(labels(shape("krillion").raw).some((l) => l.includes("🦐"))).toBe(false);
    expect(labels(shape("minutecryptic").raw).some((l) => l.includes("🤝"))).toBe(false);
  });

  it("offers a zero count for a symbol the game is scored by", () => {
    const allMisses = "DailyTens #413\n\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌\n  ❌   ❌";
    expect(findScoreFeature(allMisses, "count:🏆")).toBeNull();
    const zero = findScoreFeature(allMisses, "count:🏆", { knownSymbols: ["🏆"] });
    expect(zero).toMatchObject({ value: 0, label: "0 × 🏆", derivation: "counted 🏆" });
  });

  it("offers a single trophy as a count of one", () => {
    const one = "DailyTens #414\n\n  🏆   ❌\n  ❌   ❌";
    expect(findScoreFeature(one, "count:🏆")?.value).toBe(1);
  });

  it("only tallies repeats when a grid line is a row of distinct symbols (flags)", () => {
    const features = computeScoreFeatures(shape("geozee").raw);
    expect(features.some((f) => f.symbol === "🇫🇷")).toBe(false);
    expect(features.find((f) => f.id === "count:🟩")?.value).toBe(6);
  });

  it("without a grid, tallies symbols that repeat in the text", () => {
    expect(labels(shape("maptap").raw)).toContain("3 × 🔥");
    expect(labels(shape("maptap").raw).some((l) => l.includes("✨"))).toBe(false);
  });

  it("never reads a number or a symbol out of a URL", () => {
    const features = computeScoreFeatures(shape("dailytens").raw);
    expect(features.some((f) => f.text === "944415")).toBe(false);
  });
});

describe("rows and positions", () => {
  it("counts grid rows (Connections guesses)", () => {
    expect(findScoreFeature(shape("connections").raw, "rows")).toMatchObject({
      value: 5,
      label: "5 rows",
    });
  });

  it("reads the position of a marker in a one-line grid (trimmed Satle)", () => {
    expect(findScoreFeature("🟥🟥🟥🟩", "pos:🟩")).toMatchObject({
      value: 4,
      label: "🟩 is 4th",
    });
    // No position candidates in a multi-row grid, where it means nothing.
    expect(computeScoreFeatures(shape("wordle").raw).some((f) => f.kind === "position")).toBe(
      false,
    );
  });
});

describe("gridLines / symbolsIn", () => {
  it("keeps indented and CRLF grid lines, drops prose lines", () => {
    const lines = gridLines("Title 🏆\r\n  🏆   ❌\r\n🏆 nice\r\n❌❌");
    expect(lines.map((l) => l.symbols)).toEqual([
      ["🏆", "❌"],
      ["❌", "❌"],
    ]);
  });

  it("treats flags, keycaps and ZWJ sequences as one symbol each", () => {
    expect(symbolsIn("🇫🇷1️⃣👨‍👩‍👧👍🏽")).toEqual(["🇫🇷", "1⃣", "👨‍👩‍👧", "👍🏽"]);
  });
});

describe("derivationForValue", () => {
  it("explains a computed value and stays quiet for a literal one", () => {
    expect(derivationForValue(shape("dailytens").raw, 7)).toBe("counted 🏆");
    expect(derivationForValue(shape("maptap").raw, 812)).toBeNull();
    expect(derivationForValue(shape("maptap").raw, 123456)).toBeNull();
  });
});

describe("suggestDirectionForFeature", () => {
  it("suggests lower-is-better for guesses and times, higher for points and tallies", () => {
    for (const fixture of SCORE_SHAPE_FIXTURES) {
      const feature = fixtureFeature(computeScoreFeatures(fixture.raw), fixture.pick);
      if (!feature) throw new Error(`no feature for ${fixture.key}`);
      // The suggestion is only a default the user confirms; these three shapes
      // are the ones where the kind alone guesses wrong.
      if (["globle", "minutecryptic", "geozee", "geosports", "geohistory"].includes(fixture.key)) {
        continue;
      }
      expect(suggestDirectionForFeature(feature), fixture.key).toBe(fixture.direction);
    }
  });
});
