import { describe, expect, it } from "vitest";
import { PIXEL_ICON_PATHS } from "./pixelIconPaths";
import { PIXEL_GRID, parseRectilinearPath, rasterizePixelIcon } from "./pixelIconRaster";

describe("rasterizePixelIcon", () => {
  it("fills a plain rectangle", () => {
    expect(rasterizePixelIcon(["M4 6h7v2H4z"])).toEqual([{ x: 4, y: 6, w: 7, h: 2 }]);
  });

  it("applies even-odd fill so a nested box becomes a ring", () => {
    const rects = rasterizePixelIcon(["M2 2h8v8H2zM4 4h4v4H4z"]);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBe(64 - 16);
  });

  it("rejects curves — every vendored glyph must stay rectilinear", () => {
    expect(() => parseRectilinearPath("M0 0C1 1 2 2 3 3z")).toThrow(/unsupported/);
  });

  it("rasterizes every vendored icon to a non-empty, in-bounds shape", () => {
    for (const [name, paths] of Object.entries(PIXEL_ICON_PATHS)) {
      const rects = rasterizePixelIcon(paths);
      expect(rects.length, name).toBeGreaterThan(0);
      for (const r of rects) {
        expect(r.x + r.w, name).toBeLessThanOrEqual(PIXEL_GRID);
        expect(r.y + r.h, name).toBeLessThanOrEqual(PIXEL_GRID);
      }
    }
  });
});
