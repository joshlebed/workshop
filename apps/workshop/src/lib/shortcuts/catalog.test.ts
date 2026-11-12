import { describe, expect, it } from "vitest";
import { isTypingTarget, matchShortcut } from "./catalog";

const k = (
  key: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("matchShortcut", () => {
  it("maps the documented keys", () => {
    expect(matchShortcut(k("/"))).toBe("search");
    expect(matchShortcut(k("k", { metaKey: true }))).toBe("search");
    expect(matchShortcut(k("K", { ctrlKey: true }))).toBe("search");
    expect(matchShortcut(k("n"))).toBe("new");
    expect(matchShortcut(k("/", { metaKey: true }))).toBe("activity");
    expect(matchShortcut(k("?", { shiftKey: true }))).toBe("help");
    expect(matchShortcut(k("z", { metaKey: true }))).toBe("undo");
    expect(matchShortcut(k("z", { ctrlKey: true }))).toBe("undo");
  });

  it("leaves browser and system chords alone", () => {
    expect(matchShortcut(k("n", { metaKey: true }))).toBeNull();
    expect(matchShortcut(k("N", { shiftKey: true }))).toBeNull();
    expect(matchShortcut(k("/", { altKey: true }))).toBeNull();
    expect(matchShortcut(k("r", { metaKey: true }))).toBeNull();
    expect(matchShortcut(k("a"))).toBeNull();
    expect(matchShortcut(k("z", { metaKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is true for fields", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: () => "textbox" })).toBe(true);
  });
  it("is false for the page", () => {
    expect(isTypingTarget({ tagName: "BUTTON", getAttribute: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
