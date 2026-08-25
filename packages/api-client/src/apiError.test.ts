import { describe, expect, it } from "vitest";
import { ApiError, apiErrorCode, errorMessage } from "./apiError";

describe("apiErrorCode", () => {
  it("returns the structured code from an ApiError's details", () => {
    const e = new ApiError("VALIDATION", "bad", 400, { code: "PLAYLIST_NOT_AVAILABLE" });
    expect(apiErrorCode(e)).toBe("PLAYLIST_NOT_AVAILABLE");
  });

  it("returns undefined when details has no `code` field", () => {
    const e = new ApiError("VALIDATION", "bad", 400, { foo: 1 });
    expect(apiErrorCode(e)).toBeUndefined();
  });

  it("returns undefined when details is missing entirely", () => {
    const e = new ApiError("VALIDATION", "bad", 400);
    expect(apiErrorCode(e)).toBeUndefined();
  });

  it("returns undefined for non-ApiError values", () => {
    expect(apiErrorCode(new Error("x"))).toBeUndefined();
    expect(apiErrorCode("string")).toBeUndefined();
    expect(apiErrorCode(undefined)).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("returns Error.message for any Error subclass", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new ApiError("VALIDATION", "nope", 400))).toBe("nope");
  });

  it("returns the fallback for non-Error values", () => {
    expect(errorMessage("string")).toBe("Unknown error");
    expect(errorMessage(undefined, "Couldn't load")).toBe("Couldn't load");
    expect(errorMessage(null, "Couldn't load")).toBe("Couldn't load");
  });
});
