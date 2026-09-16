import { describe, expect, it } from "vitest";
import { containsObjectionableContent } from "./contentFilter.js";

describe("containsObjectionableContent", () => {
  it("flags slurs as whole words, case-insensitively", () => {
    expect(containsObjectionableContent("Nigger")).toBe(true);
    expect(containsObjectionableContent("you FAGGOT lol")).toBe(true);
    expect(containsObjectionableContent("kys")).toBe(true);
    expect(containsObjectionableContent("kill yourself")).toBe(true);
  });

  it("sees through leet and separator obfuscation", () => {
    expect(containsObjectionableContent("n1gg3r")).toBe(true);
    expect(containsObjectionableContent("n.i.g.g.e.r")).toBe(true);
    expect(containsObjectionableContent("f@g")).toBe(true);
  });

  it("leaves ordinary names and score pastes alone", () => {
    for (const ok of [
      "Ada Lovelace",
      "Josh",
      "night owl",
      "assess the class",
      "Wordle 1,532 4/6\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩",
      "Connections\nPuzzle #812\n🟪🟪🟪🟪\n🟦🟦🟦🟦",
      "#Worldle #1234 3/6 (100%)",
      "Scunthorpe United",
      "fagioli soup",
    ]) {
      expect(containsObjectionableContent(ok), ok).toBe(false);
    }
  });
});
