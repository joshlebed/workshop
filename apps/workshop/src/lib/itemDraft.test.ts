import { describe, expect, it } from "vitest";
import { draftFromServer, isDraftDirty, reconcileDraftField } from "./itemDraft";

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[a-z]+:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

describe("reconcileDraftField", () => {
  const base = { normalizeUrl, field: "title" as const };

  it("never touches a focused field, even when the server moved", () => {
    expect(
      reconcileDraftField({
        ...base,
        draft: "Pottery class with friends and",
        prevServer: "Pottery class",
        nextServer: "Pottery class with friends",
        focused: true,
      }),
    ).toBe("Pottery class with friends and");
  });

  it("keeps an unsaved local edit in an unfocused field", () => {
    expect(
      reconcileDraftField({
        ...base,
        draft: "Pottery class with friends and wine",
        prevServer: "Pottery class",
        nextServer: "Pottery class with friends",
        focused: false,
      }),
    ).toBe("Pottery class with friends and wine");
  });

  it("adopts the trimmed server value once the field is blurred", () => {
    expect(
      reconcileDraftField({
        ...base,
        draft: "Pottery class ",
        prevServer: "Pottery",
        nextServer: "Pottery class",
        focused: false,
      }),
    ).toBe("Pottery class");
  });

  it("follows another member's edit when there is no local edit", () => {
    expect(
      reconcileDraftField({
        ...base,
        draft: "Pottery class",
        prevServer: "Pottery class",
        nextServer: "Pottery class (Sat)",
        focused: false,
      }),
    ).toBe("Pottery class (Sat)");
  });

  it("adopts the normalized URL the server stored", () => {
    expect(
      reconcileDraftField({
        normalizeUrl,
        field: "url",
        draft: "example.com",
        prevServer: "",
        nextServer: "https://example.com",
        focused: false,
      }),
    ).toBe("https://example.com");
  });
});

describe("isDraftDirty", () => {
  const server = draftFromServer({ title: "Pasta", note: null, url: "https://a.com" });

  it("ignores whitespace and URL normalization", () => {
    expect(isDraftDirty({ title: "Pasta ", note: "  ", url: "a.com" }, server, normalizeUrl)).toBe(
      false,
    );
  });

  it("sees a real change", () => {
    expect(isDraftDirty({ title: "Pasta!", note: "", url: "a.com" }, server, normalizeUrl)).toBe(
      true,
    );
  });
});

describe("reconcileTextDraft (list settings name/description)", () => {
  it("never lets a refetch replace a focused or locally edited field", async () => {
    const { reconcileTextDraft } = await import("./itemDraft");
    expect(
      reconcileTextDraft({
        draft: "Movies to",
        prevServer: "Movies",
        nextServer: "Movies",
        focused: true,
      }),
    ).toBe("Movies to");
    expect(
      reconcileTextDraft({
        draft: "Movies 2",
        prevServer: "Movies",
        nextServer: "Films",
        focused: false,
      }),
    ).toBe("Movies 2");
    expect(
      reconcileTextDraft({
        draft: "Movies",
        prevServer: "Movies",
        nextServer: "Films",
        focused: false,
      }),
    ).toBe("Films");
    expect(
      reconcileTextDraft({
        draft: "Films ",
        prevServer: "Movies",
        nextServer: "Films",
        focused: false,
      }),
    ).toBe("Films");
  });
});
