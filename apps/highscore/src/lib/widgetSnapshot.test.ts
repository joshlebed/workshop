import { USER_FLAG_KEYS } from "@workshop/shared/constants";
import type { GamesResponse, MyGame } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
  buildWidgetSnapshot,
  cardDismissedFlagValue,
  cardShownFlagValue,
  installedFlagValue,
  runtimeHasWidget,
  shouldShowWidgetCard,
  signedOutWidgetSnapshot,
  widgetTapFromUrl,
} from "./widgetSnapshot";

const me = "00000000-0000-4000-8000-000000000001";
const sam = "00000000-0000-4000-8000-000000000002";
const riley = "00000000-0000-4000-8000-000000000003";
const gameId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function game(n: number, players: string[], friendCount?: number): MyGame {
  return {
    gameId: gameId(n),
    position: n,
    addedAt: "2026-11-01T00:00:00.000Z",
    game: { id: gameId(n), title: `Game ${n}` } as MyGame["game"],
    standings: {
      periodKey: "2026-11-25",
      entries: players.map((userId) => ({
        userId,
        displayName: `name-${userId}`,
        avatarVersion: null,
        scoreRaw: "secret 937",
        scoreValue: 937,
        rank: 1,
        updatedAt: null,
        reactions: [],
      })),
      viewerHasPlayed: players.includes(me),
      viewerStreak: 0,
    },
    ...(friendCount === undefined ? {} : { friendCount }),
  };
}

const response = (games: MyGame[]): GamesResponse => ({ periodKey: "2026-11-25", games });

describe("buildWidgetSnapshot", () => {
  it("lists the first four games with your state and friend counts", () => {
    const snap = buildWidgetSnapshot(
      response([
        game(1, [me, sam], 5),
        game(2, [sam, riley], 2),
        game(3, [], 0),
        game(4, [me]),
        game(5, [sam], 1),
        game(6, []),
      ]),
      me,
    );
    expect(snap).toEqual({
      v: 1,
      signedIn: true,
      day: "2026-11-25",
      games: [
        { id: gameId(1), name: "Game 1", you: true, played: 1, friends: 5 },
        { id: gameId(2), name: "Game 2", you: false, played: 2, friends: 2 },
        { id: gameId(3), name: "Game 3", you: false, played: 0, friends: 0 },
        // Older server without friendCount: the "of" is who posted.
        { id: gameId(4), name: "Game 4", you: true, played: 0, friends: 0 },
      ],
      more: 2,
    });
  });

  it("never lets the 'of' fall below the friends who posted", () => {
    const snap = buildWidgetSnapshot(response([game(1, [sam, riley], 1)]), me);
    expect(snap.games[0]).toMatchObject({ played: 2, friends: 2 });
  });

  it("carries no friend names or scores", () => {
    const json = JSON.stringify(buildWidgetSnapshot(response([game(1, [me, sam], 3)]), me));
    expect(json).not.toContain("name-");
    expect(json).not.toContain("937");
    expect(json).not.toContain(sam);
  });

  it("signed out is an empty snapshot", () => {
    expect(signedOutWidgetSnapshot("2026-11-25")).toEqual({
      v: 1,
      signedIn: false,
      day: "2026-11-25",
      games: [],
      more: 0,
    });
  });
});

describe("widgetTapFromUrl", () => {
  it("reads the game and family from a widget deep link", () => {
    expect(widgetTapFromUrl(`highscore:///games/${gameId(1)}?src=widget&family=medium`)).toEqual({
      family: "medium",
      gameId: gameId(1),
    });
    expect(widgetTapFromUrl("highscore:///?src=widget&family=small")).toEqual({
      family: "small",
      gameId: null,
    });
    expect(widgetTapFromUrl(`highscore:///games/${gameId(1)}?src=widget&family=xl`)).toEqual({
      family: "other",
      gameId: gameId(1),
    });
  });

  it("ignores anything that isn't a widget tap", () => {
    expect(widgetTapFromUrl(null)).toBeNull();
    expect(widgetTapFromUrl(`highscore:///games/${gameId(1)}`)).toBeNull();
    expect(widgetTapFromUrl("highscore:///games/x?src=push")).toBeNull();
  });
});

describe("runtimeHasWidget", () => {
  it("is iOS 1.4.0+ only", () => {
    expect(runtimeHasWidget("ios", "1.4.0")).toBe(true);
    expect(runtimeHasWidget("ios", "1.10.0")).toBe(true);
    expect(runtimeHasWidget("ios", "1.3.0")).toBe(false);
    expect(runtimeHasWidget("ios", null)).toBe(false);
    expect(runtimeHasWidget("android", "1.4.0")).toBe(false);
    expect(runtimeHasWidget("web", "1.4.0")).toBe(false);
  });
});

describe("shouldShowWidgetCard", () => {
  const base = { flags: {}, supported: true, hasPosted: true, otherCardVisible: false };

  it("shows after the first score on a supported binary", () => {
    expect(shouldShowWidgetCard(base)).toBe(true);
  });

  it("waits for flags, a score, a supported binary and the other card", () => {
    expect(shouldShowWidgetCard({ ...base, flags: undefined })).toBe(false);
    expect(shouldShowWidgetCard({ ...base, hasPosted: false })).toBe(false);
    expect(shouldShowWidgetCard({ ...base, supported: false })).toBe(false);
    expect(shouldShowWidgetCard({ ...base, otherCardVisible: true })).toBe(false);
  });

  it("is gone after the X and once a widget is on the home screen", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(
      shouldShowWidgetCard({
        ...base,
        flags: { [USER_FLAG_KEYS.widgetCard]: cardDismissedFlagValue(undefined, now) },
      }),
    ).toBe(false);
    expect(
      shouldShowWidgetCard({
        ...base,
        flags: { [USER_FLAG_KEYS.widgetInstalled]: { firstSeenAt: "x", via: "tap" } },
      }),
    ).toBe(false);
    // Shown but not dismissed: it stays.
    expect(
      shouldShowWidgetCard({
        ...base,
        flags: { [USER_FLAG_KEYS.widgetCard]: { shownAt: "2026-11-24T00:00:00.000Z" } },
      }),
    ).toBe(true);
  });

  it("stamps shownAt once and keeps it on dismiss", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(cardShownFlagValue(undefined, now)).toEqual({ shownAt: now.toISOString() });
    expect(cardShownFlagValue({ shownAt: "earlier" }, now)).toBeNull();
    expect(cardDismissedFlagValue({ shownAt: "earlier" }, now)).toEqual({
      shownAt: "earlier",
      dismissedAt: now.toISOString(),
    });
  });
});

describe("installedFlagValue", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const marker = { timelineAt: "2026-11-25T11:00:00Z", families: ["medium", "small"] };

  it("records a tap or a timeline marker once", () => {
    expect(installedFlagValue({}, { tap: { family: "small", gameId: null } }, now)).toEqual({
      firstSeenAt: now.toISOString(),
      via: "tap",
      family: "small",
    });
    expect(installedFlagValue({}, { marker }, now)).toEqual({
      firstSeenAt: now.toISOString(),
      via: "timeline",
      family: "medium,small",
    });
  });

  it("writes nothing without evidence, before flags load, or when already set", () => {
    expect(installedFlagValue({}, { marker: null }, now)).toBeNull();
    expect(installedFlagValue(undefined, { marker }, now)).toBeNull();
    expect(
      installedFlagValue({ [USER_FLAG_KEYS.widgetInstalled]: { via: "tap" } }, { marker }, now),
    ).toBeNull();
  });
});
