import { describe, expect, it } from "vitest";
import { parseReturnPath, safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it("honours the short share URL, the canonical list URL and a legacy invite", () => {
    expect(safeReturnPath("/l/piK7Bbyt")).toBe("/l/piK7Bbyt");
    expect(safeReturnPath("/list/f2808a9c-80cc-4943-b46c-016abad67b98")).toBe(
      "/list/f2808a9c-80cc-4943-b46c-016abad67b98",
    );
    expect(safeReturnPath("/invite/abc_123")).toBe("/invite/abc_123");
  });

  it("rejects anything that isn't an in-app list path", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath("/")).toBeNull();
    expect(safeReturnPath("/friends")).toBeNull();
    expect(safeReturnPath("//evil.example/l/x")).toBeNull();
    expect(safeReturnPath("https://evil.example/l/x")).toBeNull();
    expect(safeReturnPath("/l/")).toBeNull();
    expect(safeReturnPath("/invite/")).toBeNull();
  });
});

describe("parseReturnPath", () => {
  it("names the list a stash points at", () => {
    expect(parseReturnPath("/l/piK7Bbyt")).toEqual({ kind: "slug", slug: "piK7Bbyt" });
    expect(parseReturnPath("/list/abc-123/settings")).toEqual({ kind: "list", id: "abc-123" });
    expect(parseReturnPath("/invite/tok?x=1")).toEqual({ kind: "invite", token: "tok" });
  });

  it("ignores unsafe or unknown paths", () => {
    expect(parseReturnPath("https://evil.example/l/x")).toBeNull();
    expect(parseReturnPath(null)).toBeNull();
  });
});
