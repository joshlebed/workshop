import type { FriendQuest, FriendSummary } from "@workshop/shared/friends";
import { describe, expect, it } from "vitest";
import {
  celebrationText,
  doneQuestsLabel,
  friendFirstName,
  keepAliveLines,
  moreStreaksLabel,
  pairFlame,
  questCountLabel,
  questProgress,
  questStatusLine,
  questTitle,
} from "./friendStreaks";

function friend(
  userId: string,
  displayName: string | null,
  days: number,
  viewerPostedToday: boolean,
  friendPostedToday: boolean,
): FriendSummary {
  return {
    userId,
    displayName,
    friendsSince: "2026-01-01T00:00:00Z",
    streak: { days, viewerPostedToday, friendPostedToday },
  };
}

function quest(overrides: Partial<FriendQuest> = {}): FriendQuest {
  return {
    friend: { userId: "s", displayName: "Sam Smith" },
    weekStart: "2026-11-23",
    weekEnd: "2026-11-29",
    target: 10,
    count: 7,
    viewerCount: 3,
    friendCount: 4,
    completedAt: null,
    celebrate: false,
    ...overrides,
  };
}

describe("pairFlame", () => {
  it("shows from two days", () => {
    expect(pairFlame(undefined)).toBeNull();
    expect(pairFlame({ days: 1, viewerPostedToday: true, friendPostedToday: true })).toBeNull();
    expect(pairFlame({ days: 2, viewerPostedToday: true, friendPostedToday: true })).toBe(2);
  });
});

describe("keepAliveLines", () => {
  it("lists streaks waiting on someone today, the viewer's to save first", () => {
    const lines = keepAliveLines([
      friend("a", "Sam Smith", 5, false, true),
      friend("b", "Riley", 9, true, false),
      friend("c", "Quinn", 3, false, false),
      friend("d", "Done", 7, true, true), // both posted: nothing at stake
      friend("e", "Short", 1, false, true), // below the flame threshold
      { userId: "f", displayName: "Old client", friendsSince: "2026-01-01T00:00:00Z" },
    ]);
    expect(lines.map((l) => [l.friendId, l.waitingOn, l.text])).toEqual([
      ["a", "viewer", "You and Sam: 5 days — post to keep it"],
      ["c", "both", "You and Quinn: 3 days — post to keep it"],
      ["b", "friend", "You and Riley: 9 days — waiting on Riley today"],
    ]);
  });

  it("caps the number of lines", () => {
    const many = ["a", "b", "c", "d"].map((id, i) => friend(id, id, 2 + i, false, false));
    expect(keepAliveLines(many, 2).map((l) => l.friendId)).toEqual(["d", "c"]);
  });
});

describe("folded lines", () => {
  it("counts the streaks left out and names finished quests", () => {
    expect(moreStreaksLabel(1)).toBe("+1 more streak to keep · see Friends");
    expect(moreStreaksLabel(4)).toBe("+4 more streaks to keep · see Friends");
    const done = (name: string) => quest({ friend: { userId: name, displayName: name } });
    expect(doneQuestsLabel([done("Ana")])).toBe("Done with Ana");
    expect(doneQuestsLabel([done("Ana"), done("Bo"), done("Cy")])).toBe("Done with Ana, Bo & Cy");
  });
});

describe("quest copy", () => {
  it("names the friend by first name", () => {
    expect(friendFirstName("  Sam Smith ")).toBe("Sam");
    expect(friendFirstName(null)).toBe("your friend");
    expect(questTitle(quest())).toBe("You + Sam");
  });

  it("says what's left, or that it's done", () => {
    expect(questStatusLine(quest())).toBe("3 more scores together by Sunday");
    expect(questStatusLine(quest({ count: 9 }))).toBe("1 more score together by Sunday");
    expect(questStatusLine(quest({ completedAt: "2026-11-25T10:00:00Z", count: 11 }))).toBe(
      "Done · 11 posted together",
    );
    expect(questCountLabel(quest({ completedAt: "2026-11-25T10:00:00Z", count: 63 }))).toBe(
      "10/10",
    );
  });

  it("clips progress", () => {
    expect(questProgress(quest())).toBe(0.7);
    expect(questProgress(quest({ count: 14 }))).toBe(1);
  });

  it("celebrates with the real count", () => {
    expect(celebrationText(quest({ count: 11 }))).toBe(
      "You and Sam posted 11 scores together this week.",
    );
  });
});
