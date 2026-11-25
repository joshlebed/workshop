import { describe, expect, it } from "vitest";
import { challengeShareText, challengeTimeLeft } from "./challenge";

describe("challengeShareText", () => {
  it("names the score, the game and the link", () => {
    expect(
      challengeShareText({
        display: "937",
        gameTitle: "MapTap",
        url: "https://highscore.live/c/AbCd1234",
      }),
    ).toBe("I got 937 on today's MapTap. Beat me: https://highscore.live/c/AbCd1234");
  });
});

describe("challengeTimeLeft", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");

  it("counts whole hours, then minutes", () => {
    expect(challengeTimeLeft("2026-11-26T12:00:00Z", now)).toBe("Ends in 24h");
    expect(challengeTimeLeft("2026-11-25T13:59:00Z", now)).toBe("Ends in 1h");
    expect(challengeTimeLeft("2026-11-25T12:40:30Z", now)).toBe("Ends in 40 min");
    expect(challengeTimeLeft("2026-11-25T12:01:00Z", now)).toBe("Ends in a minute");
  });

  it("is null once the challenge is over or the date is bad", () => {
    expect(challengeTimeLeft("2026-11-25T12:00:00Z", now)).toBeNull();
    expect(challengeTimeLeft("nope", now)).toBeNull();
  });
});
