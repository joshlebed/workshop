import { describe, expect, it } from "vitest";
import { avatarUrlSchema } from "./users.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

describe("avatarUrlSchema", () => {
  it("accepts a png base64 data URL", () => {
    expect(avatarUrlSchema.safeParse(PNG_DATA_URL).success).toBe(true);
  });

  it("accepts jpeg / webp / gif data URLs", () => {
    expect(avatarUrlSchema.safeParse("data:image/jpeg;base64,/9j/4AAQ").success).toBe(true);
    expect(avatarUrlSchema.safeParse("data:image/webp;base64,UklGRg==").success).toBe(true);
    expect(avatarUrlSchema.safeParse("data:image/gif;base64,R0lGODlh").success).toBe(true);
  });

  it("rejects a plain http(s) URL", () => {
    expect(avatarUrlSchema.safeParse("https://example.com/me.png").success).toBe(false);
  });

  it("rejects a non-image data URL", () => {
    expect(avatarUrlSchema.safeParse("data:text/plain;base64,aGk=").success).toBe(false);
  });

  it("rejects an SVG data URL (raster only)", () => {
    expect(avatarUrlSchema.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success).toBe(false);
  });

  it("rejects a payload over the size cap", () => {
    const huge = `data:image/png;base64,${"A".repeat(1_500_001)}`;
    expect(avatarUrlSchema.safeParse(huge).success).toBe(false);
  });
});
