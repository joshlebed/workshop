import { describe, expect, it } from "vitest";
import { postedCheckNotice } from "./postedCheck";

const tens = { id: "g2", title: "Daily Tens", url: "https://dailytens.com", iconUrl: null };

describe("postedCheckNotice", () => {
  it("says nothing without a check, or with a clean one", () => {
    expect(postedCheckNotice(undefined, "2026-10-25")).toBeNull();
    expect(
      postedCheckNotice({ wrongGame: null, sameTextPeriodKey: null }, "2026-10-25"),
    ).toBeNull();
  });

  it("offers to move a post that looks like another game's, before anything else", () => {
    const notice = postedCheckNotice(
      {
        wrongGame: { game: tens as never, inMyGames: true },
        sameTextPeriodKey: "2026-10-24",
      },
      "2026-10-25",
    );
    expect(notice).toEqual({
      kind: "wrong_game",
      message: "Posted. Looks like a Daily Tens score, though.",
      actionLabel: "Move",
      other: { id: "g2", title: "Daily Tens" },
    });
  });

  it("offers to undo a repeat of another day's result", () => {
    expect(
      postedCheckNotice({ wrongGame: null, sameTextPeriodKey: "2026-10-24" }, "2026-10-25"),
    ).toMatchObject({
      kind: "same_text",
      message: "Posted. You posted this same result yesterday.",
      actionLabel: "Undo",
    });
    expect(
      postedCheckNotice({ wrongGame: null, sameTextPeriodKey: "2026-09-30" }, "2026-10-25")
        ?.message,
    ).toMatch(/^Posted\. You posted this same result on .+\.$/);
  });
});
