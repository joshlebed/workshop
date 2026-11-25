import { describe, expect, it } from "vitest";
import {
  computeFriendStreak,
  computeGameStreak,
  FRIEND_QUEST_MAX_TARGET,
  FRIEND_QUEST_MIN_TARGET,
  formatScoreValue,
  friendQuestTarget,
  friendStreakAtRisk,
  isoWeekStart,
  isReactionEmoji,
  normalizeGameUrl,
  REACTION_QUICK_EMOJIS,
  shiftPeriodKey,
} from "./games.js";

describe("normalizeGameUrl", () => {
  it("unwraps a Facebook link shim to the real game URL", () => {
    expect(
      normalizeGameUrl(
        "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.dailytens.com%2F%3Ffbclid%3Dabc&h=AT0x",
      ),
    ).toBe("dailytens.com");
    expect(normalizeGameUrl("lm.facebook.com/l.php?u=https%3A%2F%2Ftravle.earth%2Fusa")).toBe(
      "travle.earth/usa",
    );
    expect(normalizeGameUrl("https://l.instagram.com/?u=https%3A%2F%2Fframed.wtf%2F&e=x")).toBe(
      "framed.wtf",
    );
  });

  it("rejects a link shim with no usable target", () => {
    expect(normalizeGameUrl("https://l.facebook.com/l.php")).toBeNull();
    expect(normalizeGameUrl("https://l.facebook.com/l.php?u=javascript%3Aalert(1)")).toBeNull();
    expect(
      normalizeGameUrl("https://l.facebook.com/l.php?u=https%3A%2F%2Fl.facebook.com%2Fl.php"),
    ).toBeNull();
  });

  it("strips the referral query string (the dailytens.com/?ref= junk case)", () => {
    expect(normalizeGameUrl("https://dailytens.com/?ref=abc123")).toBe("dailytens.com");
  });

  it("maps a reviewed alias to its game's address", () => {
    expect(normalizeGameUrl("https://playplain.app/play/")).toBe("playplain.app");
    expect(normalizeGameUrl("bandle.app/menu?x=1")).toBe("bandle.app");
    expect(normalizeGameUrl("https://t30.teuteuf.fr/w43")).toBe("t30.teuteuf.fr");
    expect(normalizeGameUrl("https://www.wordle.com/")).toBe("nytimes.com/games/wordle");
    expect(normalizeGameUrl("https://www.alldle.net/game/dartle")).toBe("dartle.net");
    // Only the listed shapes: other paths on the same site stay their own game.
    expect(normalizeGameUrl("https://t30.teuteuf.fr/archive")).toBe("t30.teuteuf.fr/archive");
    expect(normalizeGameUrl("https://playplain.app/play/extra")).toBe("playplain.app/play/extra");
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

describe("formatScoreValue", () => {
  it("shows seconds as a time: m:ss under an hour, h and m past it", () => {
    expect(formatScoreValue(42, "seconds")).toBe("0:42");
    expect(formatScoreValue(252, "seconds")).toBe("4:12");
    expect(formatScoreValue(82800, "seconds")).toBe("23h 00m");
    expect(formatScoreValue(70800, "seconds")).toBe("19h 40m");
    expect(formatScoreValue(3930, "seconds")).toBe("1h 05m 30s");
  });

  it("leaves a plain number alone", () => {
    expect(formatScoreValue(944, null)).toBe("944");
    expect(formatScoreValue(4250, undefined)).toBe((4250).toLocaleString());
    expect(formatScoreValue(-5, "seconds")).toBe("-5");
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

describe("computeFriendStreak", () => {
  const today = "2026-06-18";

  it("counts only the days both players posted", () => {
    const me = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
    const sam = ["2026-06-16", "2026-06-17", "2026-06-18"];
    expect(computeFriendStreak(me, sam, today)).toEqual({
      days: 3,
      viewerPostedToday: true,
      friendPostedToday: true,
    });
  });

  it("is broken by a day only one of them posted", () => {
    // 06-16: Sam played, I didn't — the shared run restarts on 06-17.
    const me = ["2026-06-14", "2026-06-15", "2026-06-17", "2026-06-18"];
    const sam = ["2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
    expect(computeFriendStreak(me, sam, today).days).toBe(2);
  });

  it("stays live through yesterday while either side hasn't posted today", () => {
    const me = ["2026-06-15", "2026-06-16", "2026-06-17"];
    const sam = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
    const streak = computeFriendStreak(me, sam, today);
    expect(streak).toEqual({ days: 3, viewerPostedToday: false, friendPostedToday: true });
    expect(friendStreakAtRisk(streak)).toBe("viewer");
  });

  it("lapses to 0 after a full day neither (or only one) of them covered", () => {
    const me = ["2026-06-14", "2026-06-15", "2026-06-16", "2026-06-18"];
    const sam = ["2026-06-14", "2026-06-15", "2026-06-16"];
    expect(computeFriendStreak(me, sam, today).days).toBe(0);
  });

  it("ignores a friend's day after the viewer's today (they are ahead in time)", () => {
    // Sam is a timezone ahead and already posted 06-19; the viewer's today is 06-18.
    const me = ["2026-06-17", "2026-06-18"];
    const sam = ["2026-06-17", "2026-06-18", "2026-06-19"];
    expect(computeFriendStreak(me, sam, today)).toEqual({
      days: 2,
      viewerPostedToday: true,
      friendPostedToday: true,
    });
  });

  it("is symmetric in its day count", () => {
    const a = ["2026-06-16", "2026-06-17", "2026-06-18"];
    const b = ["2026-06-17", "2026-06-18"];
    expect(computeFriendStreak(a, b, today).days).toBe(computeFriendStreak(b, a, today).days);
  });
});

describe("friendStreakAtRisk", () => {
  const s = (days: number, viewerPostedToday: boolean, friendPostedToday: boolean) => ({
    days,
    viewerPostedToday,
    friendPostedToday,
  });

  it("is null below STREAK_MIN_DAYS or once both posted today", () => {
    expect(friendStreakAtRisk(s(1, false, false))).toBeNull();
    expect(friendStreakAtRisk(s(5, true, true))).toBeNull();
  });

  it("names who still has to post", () => {
    expect(friendStreakAtRisk(s(5, false, true))).toBe("viewer");
    expect(friendStreakAtRisk(s(5, true, false))).toBe("friend");
    expect(friendStreakAtRisk(s(5, false, false))).toBe("both");
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the week", () => {
    expect(isoWeekStart("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(isoWeekStart("2026-11-25")).toBe("2026-11-23"); // Wednesday
    expect(isoWeekStart("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(isoWeekStart("2026-11-30")).toBe("2026-11-30"); // next Monday
  });

  it("crosses month and year boundaries", () => {
    expect(isoWeekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("friendQuestTarget", () => {
  it("is 10% above the trailing weekly average, rounded up", () => {
    // 20 scores over two weeks = 10 a week → 11.
    expect(friendQuestTarget(20)).toBe(11);
    expect(friendQuestTarget(25)).toBe(14); // 12.5 × 1.1 = 13.75
  });

  it("never goes below the minimum or above the maximum", () => {
    expect(friendQuestTarget(0)).toBe(FRIEND_QUEST_MIN_TARGET);
    expect(friendQuestTarget(4)).toBe(FRIEND_QUEST_MIN_TARGET);
    expect(friendQuestTarget(200)).toBe(FRIEND_QUEST_MAX_TARGET);
  });
});
