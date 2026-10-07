import { computeScoreFeatures, findScoreFeature } from "@workshop/shared/scoreCandidates";
import { fixtureFeature, SCORE_SHAPE_FIXTURES } from "@workshop/shared/scoreShapeFixtures";
import { describe, expect, it } from "vitest";
import { alterationsFor } from "./alteration.js";

function featureOf(raw: string, id: string) {
  const feature = findScoreFeature(raw, id);
  if (!feature) throw new Error(`no feature ${id}`);
  return feature;
}

describe("alterationsFor — the 19 prod share shapes", () => {
  for (const fixture of SCORE_SHAPE_FIXTURES) {
    it(`${fixture.title}: alters the picked feature and nothing else`, () => {
      const feature = fixtureFeature(computeScoreFeatures(fixture.raw), fixture.pick);
      if (!feature) throw new Error("fixture pick not found");
      const alterations = alterationsFor(fixture.raw, feature);
      expect(alterations.length).toBeGreaterThan(0);
      for (const alteration of alterations) {
        expect(alteration.raw).not.toBe(fixture.raw);
        expect(alteration.expected).not.toBe(fixture.value);
        // The altered text still has the same feature, now with the new value.
        expect(findScoreFeature(alteration.raw, feature.id)?.value).toBe(alteration.expected);
      }
    });
  }
});

describe("alterationsFor", () => {
  it("swaps a picked number for another number, in place", () => {
    const raw = "Krillion #81 🦐\n415\n\n🦑🏮🫧";
    const [alteration] = alterationsFor(raw, featureOf(raw, "number@16"));
    expect(alteration).toMatchObject({ raw: "Krillion #81 🦐\n414\n\n🦑🏮🫧", expected: 414 });
  });

  it("keeps a fraction inside its scale (6/6 goes down, 1/6 goes up)", () => {
    const six = "Wordle 1,573 6/6";
    expect(alterationsFor(six, featureOf(six, "fraction@13"))[0]?.raw).toBe("Wordle 1,573 5/6");
    const one = "Wordle 1,573 1/6";
    expect(alterationsFor(one, featureOf(one, "fraction@13"))[0]?.raw).toBe("Wordle 1,573 2/6");
  });

  it("alters a number with a thousands separator without breaking it", () => {
    const raw = "Score: 4,250 points";
    const [alteration] = alterationsFor(raw, featureOf(raw, "number@7"));
    expect(alteration).toMatchObject({ raw: "Score: 4,251 points", expected: 4251 });
  });

  it("adds and removes one symbol for a count, keeping the grid's shape", () => {
    const raw = "DailyTens #1\n\n  🏆   ❌\n  🏆   🏆";
    const alterations = alterationsFor(raw, featureOf(raw, "count:🏆"));
    expect(alterations.map((a) => a.expected).sort()).toEqual([2, 4]);
    for (const { raw: altered } of alterations) {
      // Still two rows of two cells.
      expect(
        altered
          .split("\n")
          .slice(2)
          .map((l) => l.trim().split(/\s+/).length),
      ).toEqual([2, 2]);
    }
  });

  it("alters a count in a one-symbol grid by appending and dropping", () => {
    const raw = "Hits\n⭐⭐⭐";
    const alterations = alterationsFor(raw, featureOf(raw, "count:⭐"));
    expect(alterations.map((a) => a.raw)).toEqual(["Hits\n⭐⭐⭐⭐", "Hits\n⭐⭐"]);
  });

  it("adds and removes a row for a row count", () => {
    const raw = "Connections\nPuzzle #1\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦";
    const alterations = alterationsFor(raw, featureOf(raw, "rows"));
    expect(alterations.map((a) => a.expected)).toEqual([4, 2]);
  });

  it("moves the marker for a position", () => {
    const raw = "🟥🟥🟥🟩";
    const [alteration] = alterationsFor(raw, featureOf(raw, "pos:🟩"));
    expect(alteration).toMatchObject({ raw: "🟥🟥🟩🟥", expected: 3 });
  });
});
