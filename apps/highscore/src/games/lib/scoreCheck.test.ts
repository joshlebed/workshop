import { describe, expect, it } from "vitest";
import type { PreviewAnswer, TeachPreview } from "../api/teach";
import {
  blocksPosting,
  pickedScoreLabel,
  resolveScoreCheck,
  roleMismatchCopy,
  SCORE_COPY,
  sameTextCopy,
  scoreReadCopy,
} from "./scoreCheck";

const preview = (over: Partial<TeachPreview> = {}, teach = {}): PreviewAnswer => ({
  kind: "preview",
  preview: {
    parseStatus: "score",
    scoreValue: 944,
    scoreSummary: null,
    teach: {
      derivation: null,
      candidates: [],
      wrongGame: null,
      sameTextPeriodKey: null,
      hasParser: true,
      ...teach,
    },
    ...over,
  },
});
const resolve = (answer: PreviewAnswer | null | undefined, over = {}) =>
  resolveScoreCheck({ empty: false, answer, waitedOut: false, wrongGameDismissed: false, ...over });

describe("resolveScoreCheck — the spec's states and copy", () => {
  it("score read: the value, with its derivation when it was computed", () => {
    expect(resolve(preview())).toEqual({ kind: "score", copy: "Score: 944" });
    expect(resolve(preview({ scoreValue: 7 }, { derivation: "counted 🏆" }))).toEqual({
      kind: "score",
      copy: "Score: 7 (counted 🏆)",
    });
  });

  it("no result", () => {
    expect(resolve(preview({ parseStatus: "no_result", scoreValue: null }))).toEqual({
      kind: "no_result",
      copy: "No score today. This posts and ranks last.",
    });
  });

  it("unread", () => {
    expect(resolve(preview({ parseStatus: "failed", scoreValue: null }))).toEqual({
      kind: "unread",
      copy: "Couldn't read a score. Tap yours:",
    });
  });

  it("wrong game, until the user says post here anyway", () => {
    const answer = preview(
      { parseStatus: "failed", scoreValue: null },
      {
        wrongGame: {
          game: { id: "g2", title: "Daily Tens", url: "https://dailytens.com" },
          inMyGames: true,
        },
      },
    );
    expect(resolve(answer)).toEqual({
      kind: "wrong_game",
      copy: "This looks like a Daily Tens score.",
      otherGameId: "g2",
      otherTitle: "Daily Tens",
    });
    expect(resolve(answer, { wrongGameDismissed: true }).kind).toBe("unread");
  });

  it("no result text, for a link-only or title-only share", () => {
    for (const reason of ["url_only", "title_only"] as const) {
      expect(resolve({ kind: "rejected", reason })).toEqual({
        kind: "no_result_text",
        copy: "We got the link but not your result. Paste your result to post a score.",
      });
    }
  });

  it("waits briefly for the preview, then lets the user post without it", () => {
    expect(resolve(undefined).kind).toBe("checking");
    expect(resolve(undefined, { waitedOut: true }).kind).toBe("no_preview");
    // A failed or malformed preview never blocks either.
    expect(resolve(null).kind).toBe("no_preview");
  });

  it("says nothing for an empty box", () => {
    expect(
      resolveScoreCheck({
        empty: true,
        answer: undefined,
        waitedOut: false,
        wrongGameDismissed: false,
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("blocksPosting", () => {
  it("only holds Post while checking, with nothing to post, or with a game to choose", () => {
    const kinds = (answer: PreviewAnswer | null | undefined, over = {}) =>
      blocksPosting(resolve(answer, over));
    expect(kinds(undefined)).toBe(true);
    expect(kinds(undefined, { waitedOut: true })).toBe(false);
    expect(kinds({ kind: "rejected", reason: "url_only" })).toBe(true);
    expect(kinds(preview())).toBe(false);
    expect(kinds(preview({ parseStatus: "failed", scoreValue: null }))).toBe(false);
  });
});

describe("copy", () => {
  it("same text as another day", () => {
    expect(sameTextCopy("2026-10-05", "2026-10-06")).toBe(
      "This is the same result you posted yesterday. Post anyway?",
    );
    expect(sameTextCopy("2026-09-30", "2026-10-06")).toMatch(
      /^This is the same result you posted on .+\. Post anyway\?$/,
    );
  });

  it("pick disagrees with label", () => {
    expect(roleMismatchCopy("puzzle_number")).toBe(
      "That looks like the puzzle number. Use it anyway?",
    );
    expect(roleMismatchCopy("score")).toBeNull();
    expect(roleMismatchCopy("other")).toBeNull();
    expect(roleMismatchCopy(undefined)).toBeNull();
  });

  it("score line and fixed strings", () => {
    expect(scoreReadCopy(42, null)).toBe("Score: 42");
    expect(SCORE_COPY.didNotFinish).toBe("I didn't finish");
    expect(SCORE_COPY.fixScore).toBe("Fix score");
  });
});

describe("pickedScoreLabel", () => {
  it("names what counts on a picked row, and nothing on a parsed one", () => {
    expect(pickedScoreLabel({ scoreSource: "picked", parseStatus: "score", scoreValue: 80 })).toBe(
      "Score: 80",
    );
    expect(
      pickedScoreLabel({ scoreSource: "picked", parseStatus: "no_result", scoreValue: null }),
    ).toBe("Didn't finish");
    expect(
      pickedScoreLabel({ scoreSource: "parsed", parseStatus: "score", scoreValue: 4 }),
    ).toBeNull();
    expect(pickedScoreLabel({ scoreValue: 4 })).toBeNull();
  });
});
