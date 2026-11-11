import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it("honours the short share URL and the canonical list URL", () => {
    expect(safeReturnPath("/l/piK7Bbyt")).toBe("/l/piK7Bbyt");
    expect(safeReturnPath("/list/f2808a9c-80cc-4943-b46c-016abad67b98")).toBe(
      "/list/f2808a9c-80cc-4943-b46c-016abad67b98",
    );
  });

  it("rejects anything that isn't an in-app list path", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath("/")).toBeNull();
    expect(safeReturnPath("/friends")).toBeNull();
    expect(safeReturnPath("//evil.example/l/x")).toBeNull();
    expect(safeReturnPath("https://evil.example/l/x")).toBeNull();
    expect(safeReturnPath("/l/")).toBeNull();
  });
});
