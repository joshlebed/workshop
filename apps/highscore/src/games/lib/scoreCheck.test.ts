import { describe, expect, it } from "vitest";
import type { PreviewAnswer, TeachPreview } from "../api/teach";
import {
  blocksPosting,
  resolveScoreCheck,
  roleMismatchCopy,
  SCORE_COPY,
  sameTextCopy,
  scoreLineLabel,
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

describe("resolveScoreCheck — a game known to have no parser never waits", () => {
  it("is unread, with the picker, before any answer and whatever the wait says", () => {
    const unread = { kind: "unread", copy: SCORE_COPY.unread };
    expect(resolve(undefined, { knownUntaught: true })).toEqual(unread);
    expect(resolve(undefined, { knownUntaught: true, waitedOut: true })).toEqual(unread);
    expect(blocksPosting(resolve(undefined, { knownUntaught: true }))).toBe(false);
  });

  it("still waits when the game has a parser or nobody has said", () => {
    expect(resolve(undefined).kind).toBe("checking");
    expect(resolve(undefined, { knownUntaught: false }).kind).toBe("checking");
    expect(resolve(undefined, { waitedOut: true }).kind).toBe("no_preview");
  });

  it("the server's answer wins once it is here", () => {
    expect(resolve(preview(), { knownUntaught: true }).kind).toBe("score");
    expect(resolve({ kind: "rejected", reason: "url_only" }, { knownUntaught: true }).kind).toBe(
      "no_result_text",
    );
    expect(resolve(undefined, { knownUntaught: true, empty: true }).kind).toBe("none");
  });
});

describe("resolveScoreCheck — the spec's states and copy", () => {
  it("score read: the value, with its derivation when it was computed", () => {
    expect(resolve(preview())).toEqual({
      kind: "score",
      copy: "Score: 944",
      value: 944,
      unit: null,
    });
    expect(resolve(preview({ scoreValue: 7 }, { derivation: "counted 🏆" }))).toEqual({
      kind: "score",
      copy: "Score: 7 (counted 🏆)",
      value: 7,
      unit: null,
    });
  });

  it("score read: a time game's seconds read as a time", () => {
    expect(resolve(preview({ scoreValue: 82800, scoreUnit: "seconds" }))).toEqual({
      kind: "score",
      copy: "Score: 23h 00m",
      value: 82800,
      unit: "seconds",
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
  it("only holds Post when the server said there is nothing to post", () => {
    const kinds = (answer: PreviewAnswer | null | undefined, over = {}) =>
      blocksPosting(resolve(answer, over));
    expect(kinds({ kind: "rejected", reason: "url_only" })).toBe(true);
    expect(kinds({ kind: "rejected", reason: "title_only" })).toBe(true);
    expect(kinds(preview())).toBe(false);
    expect(kinds(preview({ parseStatus: "failed", scoreValue: null }))).toBe(false);
  });

  it("never waits on a round trip: checking, no preview and a wrong game all post", () => {
    const kinds = (answer: PreviewAnswer | null | undefined, over = {}) =>
      blocksPosting(resolve(answer, over));
    expect(kinds(undefined)).toBe(false);
    expect(kinds(undefined, { waitedOut: true })).toBe(false);
    expect(kinds(null)).toBe(false);
    const other = { id: "g2", title: "Daily Tens", url: "https://dailytens.com" };
    const wrong = preview({}, { wrongGame: { game: other, inMyGames: true } });
    expect(resolve(wrong).kind).toBe("wrong_game");
    expect(kinds(wrong)).toBe(false);
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
    expect(scoreReadCopy(42, null, "seconds")).toBe("Score: 0:42");
    expect(SCORE_COPY.didNotFinish).toBe("I didn't finish");
    expect(SCORE_COPY.fixScore).toBe("Fix score");
  });
});

describe("scoreLineLabel — every read row of a board is shown the same way", () => {
  // Krillion on 2026-10-08: no formatter, Josh picked 270, Dag's row was read
  // by the code Josh's pick taught. Both are read rows; both say their score.
  const untaughtFormat = { hasFormatter: false };
  const picked = { scoreSource: "picked", parseStatus: "score", scoreValue: 270 };
  const reread = { scoreSource: "parsed", parseStatus: "score", scoreValue: 415 };

  it("a picked row and a parsed or re-read row both state their score", () => {
    expect(scoreLineLabel(picked, untaughtFormat, true)).toBe("Score: 270");
    expect(scoreLineLabel(reread, untaughtFormat, true)).toBe("Score: 415");
    // A time game (City2City) states its seconds as a time.
    expect(
      scoreLineLabel(
        { ...picked, scoreValue: 82800 },
        { ...untaughtFormat, scoreUnit: "seconds" },
        true,
      ),
    ).toBe("Score: 23h 00m");
    // A re-read row carries no source of its own on an older server.
    expect(scoreLineLabel({ parseStatus: "score", scoreValue: 415 }, untaughtFormat, true)).toBe(
      "Score: 415",
    );
  });

  it("a row with no result says so, and an unread row says nothing", () => {
    expect(
      scoreLineLabel(
        { scoreSource: "picked", parseStatus: "no_result", scoreValue: null },
        untaughtFormat,
        true,
      ),
    ).toBe("Didn't finish");
    expect(
      scoreLineLabel({ parseStatus: "no_result", scoreValue: null }, untaughtFormat, true),
    ).toBe("No score");
    expect(
      scoreLineLabel({ parseStatus: "failed", scoreValue: null }, untaughtFormat, true),
    ).toBeNull();
    // A row from before code parsing: the client's own summary stands.
    expect(scoreLineLabel({ scoreValue: 4 }, untaughtFormat, true)).toBeNull();
  });

  it("a game with a formatter already shows the score: only a disputed pick adds the line", () => {
    const formatted = { hasFormatter: true };
    expect(scoreLineLabel(reread, formatted, true)).toBeNull();
    // Size It Up on 2026-11-03: Rachel's pick taught the parser, which now
    // reads her text to the same value. Her row looks like everyone else's.
    expect(scoreLineLabel(picked, formatted, true)).toBeNull();
    expect(scoreLineLabel({ ...picked, adjusted: false }, formatted, true)).toBeNull();
    // The parser disagrees with the pick: the row's numbers may not be the
    // score that counts, so say it.
    expect(scoreLineLabel({ ...picked, adjusted: true }, formatted, true)).toBe("Score: 270");
    expect(
      scoreLineLabel(
        { scoreSource: "picked", parseStatus: "no_result", scoreValue: null },
        formatted,
        true,
      ),
    ).toBe("Didn't finish");
    // Without teach the same rule holds.
    expect(scoreLineLabel(picked, formatted, false)).toBeNull();
    expect(scoreLineLabel({ ...picked, adjusted: true }, formatted, false)).toBe("Score: 270");
    // A server that predates the field: unchanged.
    expect(scoreLineLabel(reread, {}, true)).toBeNull();
    expect(scoreLineLabel(picked, {}, true)).toBe("Score: 270");
  });

  it("changes nothing for an account without teach", () => {
    expect(scoreLineLabel(reread, untaughtFormat, false)).toBeNull();
    expect(scoreLineLabel(picked, untaughtFormat, false)).toBe("Score: 270");
  });
});
