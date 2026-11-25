import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import {
  deriveSetupRows,
  mergeSetupFlag,
  minutesSinceSignup,
  newlyDoneRows,
  parseSetupFlag,
  SETUP_CELEBRATE_MS,
  SETUP_WINDOW_MS,
  type SetupSignals,
  setupCardState,
  setupFlagFrom,
  todayBoardLines,
} from "./setupChecklist";

const SIGNUP = "2026-11-25T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(SIGNUP) + minutes * 60_000).toISOString();
const nowAt = (ms: number) => new Date(Date.parse(SIGNUP) + ms);

const fresh: SetupSignals = {
  friendsSince: [],
  gamesAddedAt: [],
  hasScore: false,
  shareSheet: { applicable: true, done: false },
  reminder: { applicable: true, done: false },
};

const ids = (rows: { id: string }[] | null) => rows?.map((r) => r.id);

describe("deriveSetupRows", () => {
  it("lists every row in priority order for a brand-new iOS account", () => {
    const rows = deriveSetupRows(fresh, {});
    expect(ids(rows)).toEqual(["friend", "friend2", "games", "score", "share_sheet", "reminder"]);
    expect(rows?.map((r) => r.done)).toEqual([false, false, false, false, false, false]);
    expect(rows?.filter((r) => r.next).map((r) => r.id)).toEqual(["friend"]);
    expect(rows?.find((r) => r.id === "games")?.progress).toBe("0/3");
  });

  it("drops the iOS-only rows where they don't apply (web)", () => {
    const rows = deriveSetupRows(
      { ...fresh, shareSheet: { applicable: false }, reminder: { applicable: false } },
      {},
    );
    expect(ids(rows)).toEqual(["friend", "friend2", "games", "score"]);
  });

  it("ticks friend at one friend and 'one more' at two, with the friendship times", () => {
    const one = deriveSetupRows({ ...fresh, friendsSince: [at(5)] }, {});
    expect(one?.[0]).toMatchObject({ id: "friend", done: true, doneAt: at(5) });
    expect(one?.[1]).toMatchObject({ id: "friend2", done: false, next: true });
    const two = deriveSetupRows({ ...fresh, friendsSince: [at(30), at(5)] }, {});
    expect(two?.[1]).toMatchObject({ id: "friend2", done: true, doneAt: at(30) });
    expect(two?.find((r) => r.next)?.id).toBe("games");
  });

  it("counts games up to 3 and dates the row by the third game added", () => {
    const two = deriveSetupRows({ ...fresh, gamesAddedAt: [at(1), at(2)] }, {});
    expect(two?.find((r) => r.id === "games")).toMatchObject({ progress: "2/3", done: false });
    const four = deriveSetupRows({ ...fresh, gamesAddedAt: [at(9), at(1), at(4), at(2)] }, {});
    expect(four?.find((r) => r.id === "games")).toMatchObject({
      progress: "3/3",
      done: true,
      doneAt: at(4),
    });
  });

  it("keeps a row done once recorded, even if the data no longer says so", () => {
    const rows = deriveSetupRows(fresh, { rows: { friend: at(5), score: at(40) } });
    expect(rows?.find((r) => r.id === "friend")).toMatchObject({ done: true, doneAt: at(5) });
    expect(rows?.find((r) => r.id === "score")).toMatchObject({ done: true, doneAt: at(40) });
    expect(rows?.find((r) => r.next)?.id).toBe("friend2");
  });

  it("returns null while any applicable signal is still loading", () => {
    expect(deriveSetupRows({ ...fresh, friendsSince: undefined }, {})).toBeNull();
    expect(deriveSetupRows({ ...fresh, gamesAddedAt: undefined }, {})).toBeNull();
    expect(deriveSetupRows({ ...fresh, hasScore: undefined }, {})).toBeNull();
    expect(
      deriveSetupRows({ ...fresh, reminder: { applicable: true, done: undefined } }, {}),
    ).toBeNull();
    // …but a row that doesn't apply never holds the card back.
    expect(deriveSetupRows({ ...fresh, reminder: { applicable: false } }, {})).not.toBeNull();
  });
});

const allDone: SetupSignals = {
  friendsSince: [at(1), at(2)],
  gamesAddedAt: [at(3), at(4), at(5)],
  hasScore: true,
  shareSheet: { applicable: true, done: true },
  reminder: { applicable: true, done: true },
};

describe("setupCardState", () => {
  const rows = deriveSetupRows(fresh, {});
  const doneRows = deriveSetupRows(allDone, {});

  it("shows the checklist inside the first 48h", () => {
    const state = setupCardState({ signedUpAt: SIGNUP, now: nowAt(60_000), flag: {}, rows });
    expect(state).toMatchObject({ kind: "checklist", doneCount: 0, total: 6 });
  });

  it("hides after 48h", () => {
    expect(
      setupCardState({ signedUpAt: SIGNUP, now: nowAt(SETUP_WINDOW_MS), flag: {}, rows }),
    ).toEqual({ kind: "hidden", reason: "expired" });
  });

  it("never draws while flags or rows load", () => {
    expect(setupCardState({ signedUpAt: SIGNUP, now: nowAt(0), flag: null, rows })).toEqual({
      kind: "hidden",
      reason: "loading",
    });
    expect(setupCardState({ signedUpAt: SIGNUP, now: nowAt(0), flag: {}, rows: null })).toEqual({
      kind: "hidden",
      reason: "loading",
    });
    expect(setupCardState({ signedUpAt: null, now: nowAt(0), flag: {}, rows })).toEqual({
      kind: "hidden",
      reason: "no_signup",
    });
  });

  it("stays gone once dismissed or retired", () => {
    expect(
      setupCardState({ signedUpAt: SIGNUP, now: nowAt(0), flag: { dismissedAt: at(1) }, rows }),
    ).toEqual({ kind: "hidden", reason: "dismissed" });
    expect(
      setupCardState({
        signedUpAt: SIGNUP,
        now: nowAt(0),
        flag: { completedAt: at(1), retiredAt: at(2) },
        rows: doneRows,
      }),
    ).toEqual({ kind: "hidden", reason: "retired" });
  });

  it("celebrates once every row is done, then retires", () => {
    const first = setupCardState({ signedUpAt: SIGNUP, now: nowAt(0), flag: {}, rows: doneRows });
    expect(first.kind).toBe("celebrate");
    const later = setupCardState({
      signedUpAt: SIGNUP,
      now: nowAt(60 * 60_000),
      flag: { completedAt: at(30) },
      rows: doneRows,
    });
    expect(later.kind).toBe("celebrate");
    expect(
      setupCardState({
        signedUpAt: SIGNUP,
        now: nowAt(30 * 60_000 + SETUP_CELEBRATE_MS),
        flag: { completedAt: at(30) },
        rows: doneRows,
      }),
    ).toEqual({ kind: "hidden", reason: "celebrated" });
  });

  it("still celebrates a finish at hour 47 past the window", () => {
    const state = setupCardState({
      signedUpAt: SIGNUP,
      now: nowAt(SETUP_WINDOW_MS + 60_000),
      flag: { completedAt: at(47 * 60) },
      rows: doneRows,
    });
    expect(state.kind).toBe("celebrate");
  });

  it("doesn't celebrate an account that was done before it ever saw the card, past the window", () => {
    expect(
      setupCardState({
        signedUpAt: SIGNUP,
        now: nowAt(SETUP_WINDOW_MS + 1),
        flag: {},
        rows: doneRows,
      }),
    ).toEqual({ kind: "hidden", reason: "expired" });
  });
});

describe("newlyDoneRows", () => {
  it("returns done rows not yet on the flag, with the data's time or now", () => {
    const rows = deriveSetupRows({ ...fresh, friendsSince: [at(5)], hasScore: true }, {});
    const now = nowAt(10 * 60_000);
    expect(newlyDoneRows(rows ?? [], {}, now)).toEqual([
      { id: "friend", at: at(5) },
      { id: "score", at: now.toISOString() },
    ]);
    expect(newlyDoneRows(rows ?? [], { rows: { friend: at(5) } }, now)).toEqual([
      { id: "score", at: now.toISOString() },
    ]);
  });
});

describe("flag helpers", () => {
  it("parses only well-formed fields", () => {
    expect(parseSetupFlag(null)).toEqual({});
    expect(
      parseSetupFlag({
        shownAt: at(0),
        dismissedAt: 3,
        retiredReason: "bored",
        rows: { friend: at(1), nope: at(2), games: "not a date" },
      }),
    ).toEqual({ shownAt: at(0), rows: { friend: at(1) } });
    expect(setupFlagFrom({ [USER_FLAG_KEYS.setupChecklist]: { completedAt: at(3) } })).toEqual({
      completedAt: at(3),
    });
  });

  it("merges rows per id and keeps other fields", () => {
    expect(
      mergeSetupFlag({ shownAt: at(0), rows: { friend: at(1) } }, { rows: { games: at(2) } }),
    ).toEqual({ shownAt: at(0), rows: { friend: at(1), games: at(2) } });
  });

  it("counts whole minutes since signup, never negative", () => {
    expect(minutesSinceSignup(SIGNUP, at(42))).toBe(42);
    expect(minutesSinceSignup(SIGNUP, at(-5))).toBe(0);
  });
});

describe("todayBoardLines", () => {
  it("says where the viewer stands in each of today's games", () => {
    const lines = todayBoardLines(
      [
        {
          gameId: "a",
          title: "MapTap",
          viewerHasPlayed: true,
          entries: [
            { userId: "me", rank: 1 },
            { userId: "f", rank: 2 },
          ],
        },
        {
          gameId: "b",
          title: "Krillion",
          viewerHasPlayed: false,
          entries: [{ userId: "f", rank: 1 }],
        },
        { gameId: "c", title: "Globle", viewerHasPlayed: false, entries: [] },
      ],
      "me",
    );
    expect(lines.map((l) => l.status)).toEqual(["You're #1 of 2", "1 friend posted", "Nobody yet"]);
  });
});
