import { describe, expect, it } from "vitest";
import {
  classifyClipboard,
  isLikelyGameUrl,
  linkHostLabel,
  parseUrlFooterVariant,
} from "./urlFooter";

describe("isLikelyGameUrl", () => {
  it("accepts http(s) URLs with and without a scheme", () => {
    expect(isLikelyGameUrl("https://www.nytimes.com/games/wordle/index.html")).toBe(true);
    expect(isLikelyGameUrl("wordle.com")).toBe(true);
    expect(isLikelyGameUrl("  dailytens.com/?ref=abc  ")).toBe(true);
  });
  it("rejects pasted scores, bare words and non-http schemes", () => {
    expect(isLikelyGameUrl("Wordle 1,234 4/6\n\n⬛🟩⬛⬛⬛")).toBe(false);
    expect(isLikelyGameUrl("wordle")).toBe(false);
    expect(isLikelyGameUrl("mailto:someone@example.com")).toBe(false);
    expect(isLikelyGameUrl("")).toBe(false);
    expect(isLikelyGameUrl("   ")).toBe(false);
  });
});

describe("linkHostLabel", () => {
  it("shows the normalized host only", () => {
    expect(linkHostLabel("https://www.nytimes.com/games/wordle/index.html?x=1")).toBe(
      "nytimes.com",
    );
    expect(linkHostLabel("wordle.com")).toBe("wordle.com");
  });
  it("falls back to the trimmed input when it isn't a URL", () => {
    expect(linkHostLabel("  not a url ")).toBe("not a url");
  });
});

describe("classifyClipboard", () => {
  it("distinguishes link / text / empty", () => {
    expect(classifyClipboard("https://wordle.com")).toEqual({
      kind: "link",
      text: "https://wordle.com",
    });
    expect(classifyClipboard("Wordle 1,234 4/6")).toEqual({
      kind: "text",
      text: "Wordle 1,234 4/6",
    });
    expect(classifyClipboard("")).toEqual({ kind: "empty" });
    expect(classifyClipboard("  \n ")).toEqual({ kind: "empty" });
    expect(classifyClipboard(null)).toEqual({ kind: "empty" });
  });
});

describe("parseUrlFooterVariant", () => {
  it("accepts known ids and falls back to the default", () => {
    expect(parseUrlFooterVariant("3")).toBe("3");
    expect(parseUrlFooterVariant("9")).toBe("1");
    expect(parseUrlFooterVariant(null)).toBe("1");
    expect(parseUrlFooterVariant(undefined)).toBe("1");
  });
});
