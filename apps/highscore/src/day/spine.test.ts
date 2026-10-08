import { describe, expect, it } from "vitest";
import { monthGrid, shiftMonth, spineLabel, spineWindow } from "./spine";

describe("spineWindow", () => {
  it("ends on today when the selection is inside the default week", () => {
    expect(spineWindow("2026-10-08", "2026-10-08")).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(spineWindow("2026-10-02", "2026-10-08").at(-1)).toBe("2026-10-08");
  });

  it("slides back so an older selection is the last cell", () => {
    const window = spineWindow("2026-09-20", "2026-10-08");
    expect(window).toHaveLength(7);
    expect(window.at(-1)).toBe("2026-09-20");
    expect(window[0]).toBe("2026-09-14");
  });
});

describe("spineLabel", () => {
  it("names today and yesterday", () => {
    expect(spineLabel("2026-10-08", "2026-10-08").relative).toBe("TODAY");
    expect(spineLabel("2026-10-07", "2026-10-08").relative).toBe("YESTERDAY");
    expect(spineLabel("2026-10-01", "2026-10-08").relative).toBeNull();
  });

  it("prints an upper-case weekday + month + day", () => {
    const { absolute } = spineLabel("2026-10-08", "2026-10-08");
    expect(absolute).toMatch(/^[A-Z]{3} [A-Z]{3} 8$/);
  });
});

describe("monthGrid", () => {
  it("pads to a Monday-first grid", () => {
    // Oct 1 2026 is a Thursday → three leading blanks.
    const grid = monthGrid("2026-10");
    expect(grid.slice(0, 4)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(grid.filter((d) => d.startsWith("2026-10"))).toHaveLength(31);
  });

  it("shifts months across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
