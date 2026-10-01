import { describe, expect, it } from "vitest";
import { monogramFor, monogramsFor } from "./monogram";

describe("monogramFor", () => {
  it("uses the initials of a multi-word title", () => {
    expect(monogramFor("Daily Tens")).toBe("DT");
    expect(monogramFor("NYT Mini")).toBe("NM");
  });

  it("uses the first two letters of a single word", () => {
    expect(monogramFor("Satle")).toBe("SA");
  });

  it("ignores punctuation", () => {
    expect(monogramFor("Geozee — Daily Geography")).toBe("GD");
  });
});

describe("monogramsFor", () => {
  it("keeps every plate in a deck distinct", () => {
    const marks = monogramsFor(["Travle", "Tradle", "Tradle Two"]);
    const values = [...marks.values()];
    expect(new Set(values).size).toBe(values.length);
    expect(marks.get("Travle")).toBe("TR");
  });
});
