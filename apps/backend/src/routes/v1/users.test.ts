import { describe, expect, it } from "vitest";
import { displayNameSchema } from "./users.js";

describe("displayNameSchema", () => {
  it("accepts a normal name", () => {
    const r = displayNameSchema.safeParse("Josh");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Josh");
  });

  it("trims surrounding whitespace", () => {
    const r = displayNameSchema.safeParse("  Josh  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Josh");
  });

  it("accepts emoji + non-Latin characters", () => {
    const r = displayNameSchema.safeParse("ジョシュ 🎬");
    expect(r.success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(displayNameSchema.safeParse("").success).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects names longer than 40 characters after trim", () => {
    expect(displayNameSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(displayNameSchema.safeParse(`  ${"a".repeat(40)}  `).success).toBe(true);
  });

  it("rejects names containing a newline", () => {
    expect(displayNameSchema.safeParse("foo\nbar").success).toBe(false);
  });
});
