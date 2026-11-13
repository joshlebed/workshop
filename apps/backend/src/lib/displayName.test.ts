import { describe, expect, it } from "vitest";
import { displayNameSchema, normalizeProviderDisplayName } from "./displayName.js";

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

describe("normalizeProviderDisplayName", () => {
  it("keeps a normal name", () => {
    expect(normalizeProviderDisplayName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("returns null for a blank or whitespace-only name", () => {
    expect(normalizeProviderDisplayName("")).toBeNull();
    expect(normalizeProviderDisplayName("   ")).toBeNull();
    expect(normalizeProviderDisplayName("\n\r\n")).toBeNull();
  });

  it("trims a padded name", () => {
    expect(normalizeProviderDisplayName("  Ada  ")).toBe("Ada");
  });

  it("collapses each run of line breaks to one space", () => {
    expect(normalizeProviderDisplayName("Ada\nLovelace")).toBe("Ada Lovelace");
    expect(normalizeProviderDisplayName("Ada\r\n\r\nLovelace\n")).toBe("Ada Lovelace");
  });

  it("drops a name over 40 characters instead of truncating it", () => {
    expect(normalizeProviderDisplayName("a".repeat(40))).toBe("a".repeat(40));
    expect(normalizeProviderDisplayName("a".repeat(41))).toBeNull();
    expect(normalizeProviderDisplayName(`  ${"a".repeat(40)}  `)).toBe("a".repeat(40));
  });

  it("drops a name the content filter rejects", () => {
    expect(normalizeProviderDisplayName("big retard")).toBeNull();
  });

  it("keeps emoji and non-Latin names", () => {
    expect(normalizeProviderDisplayName("Ada 🎬")).toBe("Ada 🎬");
    expect(normalizeProviderDisplayName("ジョシュ")).toBe("ジョシュ");
    expect(normalizeProviderDisplayName("Анна Каренина")).toBe("Анна Каренина");
  });

  it("returns null for a non-string", () => {
    expect(normalizeProviderDisplayName(undefined)).toBeNull();
    expect(normalizeProviderDisplayName(null)).toBeNull();
    expect(normalizeProviderDisplayName(42)).toBeNull();
  });
});
