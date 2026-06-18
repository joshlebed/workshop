import { describe, expect, it } from "vitest";
import {
  computeGameStreak,
  isReactionEmoji,
  normalizeGameUrl,
  REACTION_QUICK_EMOJIS,
  shiftPeriodKey,
} from "./games.js";

describe("normalizeGameUrl", () => {
  it("strips the referral query string (the dailytens.com/?ref= junk case)", () => {
    expect(normalizeGameUrl("https://dailytens.com/?ref=abc123")).toBe("dailytens.com");
  });

  it("strips a trailing slash", () => {
    expect(normalizeGameUrl("https://globle-game.com/")).toBe("globle-game.com");
  });

  it("strips repeated trailing slashes", () => {
    expect(normalizeGameUrl("https://globle-game.com///")).toBe("globle-game.com");
  });

  it("strips www.", () => {
    expect(normalizeGameUrl("https://www.nytimes.com/games/wordle")).toBe(
      "nytimes.com/games/wordle",
    );
  });

  it("lowercases the host but preserves path case", () => {
    expect(normalizeGameUrl("https://DailyTens.COM/Daily/Path")).toBe("dailytens.com/Daily/Path");
  });

  it("drops the fragment", () => {
    expect(normalizeGameUrl("https://travle.earth/#play")).toBe("travle.earth");
  });

  it("drops query and fragment together while keeping the path", () => {
    expect(normalizeGameUrl("https://oec.world/en/tradle/?utm=x#today")).toBe(
      "oec.world/en/tradle",
    );
  });

  it("keeps a meaningful path", () => {
    expect(normalizeGameUrl("https://nytimes.com/games/wordle/index.html")).toBe(
      "nytimes.com/games/wordle/index.html",
    );
  });

  it("trims a trailing slash after a path", () => {
    expect(normalizeGameUrl("https://www.nytimes.com/games/wordle/")).toBe(
      "nytimes.com/games/wordle",
    );
  });

  it("collapses http and https variants to the same key", () => {
    expect(normalizeGameUrl("http://framed.wtf")).toBe(normalizeGameUrl("https://framed.wtf"));
  });

  it("accepts scheme-less input", () => {
    expect(normalizeGameUrl("dailytens.com/?ref=xyz")).toBe("dailytens.com");
    expect(normalizeGameUrl("www.satle.ca/")).toBe("satle.ca");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGameUrl("  https://maptap.gg/  ")).toBe("maptap.gg");
  });

  it("keeps a non-default port", () => {
    expect(normalizeGameUrl("https://example.com:8443/play")).toBe("example.com:8443/play");
  });

  it("drops a default port", () => {
    expect(normalizeGameUrl("https://example.com:443/play")).toBe("example.com/play");
  });

  it("all catalog-style variants of one game collapse to one key", () => {
    const variants = [
      "https://www.dailytens.com",
      "https://dailytens.com/",
      "http://dailytens.com/?ref=abc",
      "dailytens.com#scores",
      "HTTPS://DAILYTENS.COM/",
    ];
    const keys = new Set(variants.map(normalizeGameUrl));
    expect(keys).toEqual(new Set(["dailytens.com"]));
  });

  it("rejects empty / whitespace input", () => {
    expect(normalizeGameUrl("")).toBeNull();
    expect(normalizeGameUrl("   ")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeGameUrl("ftp://dailytens.com")).toBeNull();
    expect(normalizeGameUrl("javascript://alert(1)")).toBeNull();
    expect(normalizeGameUrl("mailto:hi@dailytens.com")).toBeNull();
  });

  it("rejects undotted hosts and unparseable input", () => {
    expect(normalizeGameUrl("wordle")).toBeNull();
    expect(normalizeGameUrl("not a url")).toBeNull();
  });
});

describe("isReactionEmoji", () => {
  it("accepts every quick-bar emoji", () => {
    for (const emoji of REACTION_QUICK_EMOJIS) {
      expect(isReactionEmoji(emoji)).toBe(true);
    }
  });

  it("accepts skin-tone modifiers, flags, and ZWJ sequences", () => {
    expect(isReactionEmoji("👍🏽")).toBe(true);
    expect(isReactionEmoji("🇺🇸")).toBe(true);
    expect(isReactionEmoji("👨‍👩‍👧")).toBe(true);
    expect(isReactionEmoji("❤️")).toBe(true);
  });

  it("accepts keycap emoji (digit + enclosing keycap) the OS picker offers", () => {
    for (const e of ["0️⃣", "5️⃣", "9️⃣", "#️⃣", "*️⃣", "🔟"]) {
      expect(isReactionEmoji(e), e).toBe(true);
    }
  });

  it("accepts a broad sample across every emoji-keyboard category", () => {
    const sample = [
      "😀",
      "🥹",
      "🤣",
      "🫠",
      "😎",
      "🤔",
      "😴", // smileys
      "👍",
      "🙏",
      "💪",
      "✌️",
      "🫶",
      "🤷‍♂️",
      "🙆‍♀️", // gestures / people
      "❤️",
      "💯",
      "✨",
      "⭐",
      "✅",
      "❌",
      "♻️", // symbols
      "🐉",
      "🦄",
      "🦋",
      "🐙",
      "🍕",
      "🌮",
      "🥑", // animals / food
      "🎮",
      "🚀",
      "🏆",
      "🎉",
      "🎲",
      "💻",
      "🔑", // objects / activities
      "🇯🇵",
      "🇬🇧",
      "🏴‍☠️",
      "🏳️‍🌈",
      "🏳️‍⚧️",
      "🏴󠁧󠁢󠁳󠁣󠁴󠁿", // flags
      "👨‍💻",
      "🦸‍♀️",
      "🧑‍🤝‍🧑",
      "👨‍👩‍👧‍👦",
      "❤️‍🔥", // ZWJ sequences
      "🫨",
      "🩷",
      "🪿",
      "🐦‍🔥", // newer (Unicode 15/15.1)
    ];
    for (const e of sample) {
      expect(isReactionEmoji(e), e).toBe(true);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(isReactionEmoji("  🔥 ")).toBe(true);
  });

  it("rejects plain text, digits, and empty input", () => {
    expect(isReactionEmoji("nice")).toBe(false);
    expect(isReactionEmoji("5")).toBe(false);
    expect(isReactionEmoji("")).toBe(false);
    expect(isReactionEmoji("   ")).toBe(false);
    expect(isReactionEmoji("🔥 lol")).toBe(false);
  });

  it("rejects an over-long string (no essays in the emoji field)", () => {
    expect(isReactionEmoji("🔥".repeat(20))).toBe(false);
  });
});

describe("shiftPeriodKey", () => {
  it("steps forward and backward by whole days", () => {
    expect(shiftPeriodKey("2026-06-18", -1)).toBe("2026-06-17");
    expect(shiftPeriodKey("2026-06-18", 1)).toBe("2026-06-19");
    expect(shiftPeriodKey("2026-06-18", 0)).toBe("2026-06-18");
  });

  it("crosses month and year boundaries (UTC, no DST drift)", () => {
    expect(shiftPeriodKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftPeriodKey("2024-03-01", -1)).toBe("2024-02-29"); // leap year
    expect(shiftPeriodKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftPeriodKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("leaves an unparseable key untouched", () => {
    expect(shiftPeriodKey("not-a-date", -1)).toBe("not-a-date");
  });
});

describe("computeGameStreak", () => {
  const today = "2026-06-18";

  it("is 0 when the viewer has never played", () => {
    expect(computeGameStreak([], today)).toBe(0);
  });

  it("counts a run that includes today", () => {
    expect(computeGameStreak(["2026-06-16", "2026-06-17", "2026-06-18"], today)).toBe(3);
  });

  it("counts a single play today as 1 (UI thresholds at STREAK_MIN_DAYS)", () => {
    expect(computeGameStreak(["2026-06-18"], today)).toBe(1);
  });

  it("stays live when the run reached yesterday but today isn't played yet", () => {
    // The "play today to keep your streak" case — anchored on yesterday.
    expect(computeGameStreak(["2026-06-16", "2026-06-17"], today)).toBe(2);
  });

  it("lapses to 0 once the last play is older than yesterday", () => {
    expect(computeGameStreak(["2026-06-15", "2026-06-16"], today)).toBe(0);
  });

  it("only counts the consecutive run ending at the most recent play", () => {
    // The 06-10/06-11 island is severed by the 06-13 gap.
    expect(
      computeGameStreak(
        ["2026-06-10", "2026-06-11", "2026-06-16", "2026-06-17", "2026-06-18"],
        today,
      ),
    ).toBe(3);
  });

  it("ignores order and duplicate days", () => {
    expect(computeGameStreak(["2026-06-18", "2026-06-16", "2026-06-18", "2026-06-17"], today)).toBe(
      3,
    );
  });

  it("accepts a Set as well as an array", () => {
    expect(computeGameStreak(new Set(["2026-06-17", "2026-06-18"]), today)).toBe(2);
  });
});
