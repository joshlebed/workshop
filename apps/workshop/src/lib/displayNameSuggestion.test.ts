import { describe, expect, it } from "vitest";
import { cleanSuggestedName, DISPLAY_NAME_MAX, nameFromIdToken } from "./displayNameSuggestion";

function jwt(claims: object): string {
  const b64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${b64}.sig`;
}

describe("display name suggestion (4.1)", () => {
  it("reads Google's name claim, including non-ASCII", () => {
    expect(nameFromIdToken(jwt({ name: "Renée Ødegaard" }))).toBe("Renée Ødegaard");
  });

  it("returns null for a token without a name or a broken token", () => {
    expect(nameFromIdToken(jwt({ email: "a@b.c" }))).toBeNull();
    expect(nameFromIdToken("nope")).toBeNull();
    expect(nameFromIdToken(null)).toBeNull();
  });

  it("tidies and fits the field", () => {
    expect(cleanSuggestedName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(cleanSuggestedName("")).toBeNull();
    expect(cleanSuggestedName("x".repeat(60))?.length).toBe(DISPLAY_NAME_MAX);
  });
});
