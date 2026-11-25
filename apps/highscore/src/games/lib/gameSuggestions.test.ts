import { describe, expect, it } from "vitest";
import { boardRailVisible, homeRailVisible, suggestionReasonLine } from "./gameSuggestions";

describe("suggestionReasonLine", () => {
  it("names the viewer's game and the co-player count", () => {
    expect(suggestionReasonLine({ kind: "coplay", withGameTitle: "MapTap", players: 44 })).toBe(
      "44 MapTap players play this",
    );
    expect(suggestionReasonLine({ kind: "coplay", withGameTitle: "MapTap", players: 1 })).toBe(
      "A MapTap player plays this",
    );
  });
  it("says friends of friends and popular plainly", () => {
    expect(suggestionReasonLine({ kind: "friends_of_friends", players: 3 })).toBe(
      "Played by 3 friends of friends this week",
    );
    expect(suggestionReasonLine({ kind: "friends_of_friends", players: 1 })).toBe(
      "Played by a friend of a friend this week",
    );
    expect(suggestionReasonLine({ kind: "popular" })).toBe("Popular on HighScore");
  });
});

describe("boardRailVisible", () => {
  const base = {
    scorePostedThisSession: true,
    viewerScoredOnBoard: true,
    viewingToday: true,
    dismissed: false,
  };
  it("shows after a score this session on today's board", () => {
    expect(boardRailVisible(base)).toBe(true);
  });
  it("hides without a session score, without my score, on past days, or once dismissed", () => {
    expect(boardRailVisible({ ...base, scorePostedThisSession: false })).toBe(false);
    expect(boardRailVisible({ ...base, viewerScoredOnBoard: false })).toBe(false);
    expect(boardRailVisible({ ...base, viewingToday: false })).toBe(false);
    expect(boardRailVisible({ ...base, dismissed: true })).toBe(false);
  });
});

describe("homeRailVisible", () => {
  it("shows for 1–2 games only", () => {
    expect(homeRailVisible({ gameCount: 0, latched: false, dismissed: false })).toBe(false);
    expect(homeRailVisible({ gameCount: 1, latched: false, dismissed: false })).toBe(true);
    expect(homeRailVisible({ gameCount: 2, latched: false, dismissed: false })).toBe(true);
    expect(homeRailVisible({ gameCount: 3, latched: false, dismissed: false })).toBe(false);
  });
  it("stays up for the session once shown, until dismissed", () => {
    expect(homeRailVisible({ gameCount: 3, latched: true, dismissed: false })).toBe(true);
    expect(homeRailVisible({ gameCount: 2, latched: true, dismissed: true })).toBe(false);
  });
});
