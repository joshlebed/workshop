import { describe, expect, it } from "vitest";
import { firstEmoji } from "./emoji";

describe("firstEmoji", () => {
  it("takes the first whole emoji from typed or pasted text", () => {
    expect(firstEmoji("🦊")).toBe("🦊");
    expect(firstEmoji(" 🦊 fox")).toBe("🦊");
    expect(firstEmoji("fox 🦊")).toBe("🦊");
    expect(firstEmoji("🇯🇵")).toBe("🇯🇵");
    expect(firstEmoji("👩🏽‍🍳")).toBe("👩🏽‍🍳");
  });

  it("returns null when there is no emoji", () => {
    expect(firstEmoji("abc")).toBeNull();
    expect(firstEmoji("")).toBeNull();
  });
});
