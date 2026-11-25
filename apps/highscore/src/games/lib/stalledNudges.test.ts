import { describe, expect, it } from "vitest";
import { friendsWaitingLine, stalledNudgeOffer, stalledNudgeResult } from "./stalledNudges";

const f = (userId: string, displayName: string | null) => ({ userId, displayName });

describe("stalledNudgeOffer", () => {
  it("names who one tap nudges and what's left", () => {
    expect(
      stalledNudgeOffer(
        { friends: [f("s", "Sam"), f("r", "Riley")], remaining: 5, limit: 5 },
        "Score posted",
      ),
    ).toEqual({
      message: "Score posted. Nudge Sam, Riley — they haven't played yet · 5 nudges left today",
      actionLabel: "Nudge",
      recipients: [f("s", "Sam"), f("r", "Riley")],
    });
  });

  it("cuts the list to the allowance and shortens long lists", () => {
    const offer = stalledNudgeOffer(
      {
        friends: [f("a", "Ann"), f("b", null), f("c", "Cy"), f("d", "Di")],
        remaining: 3,
        limit: 5,
      },
      "Score posted",
    );
    expect(offer?.recipients.map((r) => r.userId)).toEqual(["a", "b", "c"]);
    expect(offer?.message).toBe(
      "Score posted. Nudge Ann, A friend + 1 more — they haven't played yet · 3 nudges left today",
    );
  });

  it("is unlimited for admins and absent with nobody or nothing left", () => {
    expect(
      stalledNudgeOffer({ friends: [f("s", "Sam")], remaining: null, limit: null }, "Posted")
        ?.message,
    ).toBe("Posted. Nudge Sam — they haven't played yet");
    expect(stalledNudgeOffer(undefined, "Posted")).toBeNull();
    expect(stalledNudgeOffer({ friends: [f("s", "Sam")], remaining: 0, limit: 5 }, "P")).toBeNull();
  });
});

describe("stalledNudgeResult", () => {
  const who = [f("s", "Sam"), f("r", "Riley")];
  it("says who was nudged, what's left and who wasn't", () => {
    expect(
      stalledNudgeResult({ nudged: ["s", "r"], refused: [], remaining: 3, limit: 5 }, who),
    ).toEqual({ message: "Nudged Sam and Riley · 3 nudges left today", tone: "success" });
    expect(
      stalledNudgeResult(
        {
          nudged: ["s"],
          refused: [{ userId: "r", reason: "push_failed" }],
          remaining: 1,
          limit: 5,
        },
        who,
      ).message,
    ).toBe("Nudged Sam · 1 nudge left today · 1 couldn't be nudged");
  });

  it("explains a send that reached nobody", () => {
    const none = (reason: "daily_limit" | "friend_already_played" | "push_failed") =>
      stalledNudgeResult(
        { nudged: [], refused: [{ userId: "s", reason }], remaining: 0, limit: 5 },
        who,
      ).message;
    expect(none("daily_limit")).toBe("You're out of nudges for today");
    expect(none("friend_already_played")).toBe("They've played since — check the board");
    expect(none("push_failed")).toBe("Couldn't send those nudges");
  });
});

describe("friendsWaitingLine", () => {
  it("names friends who posted, never the viewer", () => {
    expect(friendsWaitingLine([f("s", "Sam")], "me")).toBe("Sam played — your turn");
    expect(friendsWaitingLine([f("s", "Sam"), f("r", "Riley")], "me")).toBe(
      "Sam & Riley played — your turn",
    );
    expect(
      friendsWaitingLine([f("s", "Sam"), f("r", "Riley"), f("q", null), f("x", "X")], "me"),
    ).toBe("Sam, Riley + 2 more played — your turn");
    expect(friendsWaitingLine([f("me", "Mia")], "me")).toBeNull();
  });
});
