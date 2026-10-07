import type { GamesResponse } from "@workshop/shared/games";
import { computeScoreFeatures, type ScorePick } from "@workshop/shared/scoreCandidates";
import { describe, expect, it } from "vitest";
import {
  buildPostExtras,
  directionToConfirm,
  listedHasParser,
  livePick,
  pickerIsOpen,
  shouldPreselect,
  teachAvailableIn,
  teachRequestsAllowed,
} from "./scorePicker";

const RAW = "Krillion #81 🦐\n415\n\n🦑🏮🫧🦑🫧🏮";
const local = computeScoreFeatures(RAW);
const scoreId = "number@16";
const scorePick: ScorePick = { kind: "feature", featureId: scoreId };
const open = (over: Partial<Parameters<typeof pickerIsOpen>[0]> = {}) =>
  pickerIsOpen({
    available: true,
    empty: false,
    view: "score",
    asked: false,
    fixing: false,
    touched: false,
    ...over,
  });
const extras = (over: Partial<Parameters<typeof buildPostExtras>[0]> = {}) =>
  buildPostExtras({
    pickerOpen: true,
    pick: scorePick,
    overrodeRole: null,
    previewSeen: true,
    postedHereDespite: null,
    direction: null,
    ...over,
  });

describe("pickerIsOpen", () => {
  it("opens by itself when nothing read the score or no preview came", () => {
    expect(open({ view: "unread" })).toBe(true);
    expect(open({ view: "no_preview" })).toBe(true);
    expect(open({ view: "score" })).toBe(false);
    expect(open({ view: "no_result" })).toBe(false);
  });

  it("opens on Not right? and for Fix score", () => {
    expect(open({ asked: true })).toBe(true);
    expect(open({ fixing: true })).toBe(true);
  });

  it("stays open once the user has tapped a chip, whatever a late preview says", () => {
    // Slow preview: the picker opened on local chips and the user tapped 415…
    expect(open({ view: "no_preview", touched: true })).toBe(true);
    // …then the preview landed as "Score: 81". The tap must not be lost.
    expect(open({ view: "score", touched: true })).toBe(true);
    expect(open({ view: "no_result", touched: true })).toBe(true);
  });

  it("gives way to a wrong-game question and to a text with no result", () => {
    expect(open({ view: "wrong_game", touched: true, asked: true })).toBe(false);
    expect(open({ view: "no_result_text", fixing: true })).toBe(false);
  });

  it("never opens for an account without teach, or an empty box", () => {
    expect(open({ available: false, view: "unread", touched: true })).toBe(false);
    expect(open({ empty: true, view: "unread" })).toBe(false);
  });
});

describe("a tap during a late preview still posts", () => {
  it("sends the pick after the preview resolves to a score", () => {
    // The state the review described: touched, preview now says score.
    const pickerOpen = open({ view: "score", touched: true });
    expect(extras({ pickerOpen }).body.pick).toEqual(scorePick);
  });

  it("does not send a pre-selection the user never saw confirmed once the picker has closed", () => {
    const pickerOpen = open({ view: "score", touched: false });
    expect(extras({ pickerOpen }).body.pick).toBeUndefined();
  });
});

describe("livePick — the pick against the current chips", () => {
  it("survives the swap from local chips to the server's list", () => {
    // The server's list is the same computation plus what it knows of the game.
    const server = computeScoreFeatures(RAW, { knownSymbols: ["🏆"] });
    expect(server).not.toEqual(local);
    expect(livePick(scorePick, local).feature?.value).toBe(415);
    expect(livePick(scorePick, server)).toEqual({
      pick: scorePick,
      feature: local.find((f) => f.id === scoreId),
    });
  });

  it("drops a pick whose candidate is no longer offered", () => {
    expect(livePick({ kind: "feature", featureId: "number@999" }, local)).toEqual({
      pick: null,
      feature: null,
    });
  });

  it("keeps I didn't finish, which names no candidate", () => {
    expect(livePick({ kind: "no_result" }, [])).toEqual({
      pick: { kind: "no_result" },
      feature: null,
    });
  });
});

describe("shouldPreselect — the labels' suggestion never beats a tap", () => {
  it("pre-selects only while the picker is open and untouched", () => {
    expect(shouldPreselect({ pickerOpen: true, touched: false, suggestedId: scoreId })).toBe(true);
    expect(shouldPreselect({ pickerOpen: true, touched: true, suggestedId: scoreId })).toBe(false);
    expect(shouldPreselect({ pickerOpen: false, touched: false, suggestedId: scoreId })).toBe(
      false,
    );
    expect(shouldPreselect({ pickerOpen: true, touched: false, suggestedId: null })).toBe(false);
  });
});

describe("buildPostExtras — what rides on the post", () => {
  it("sends a candidate id and never a value", () => {
    const { body } = extras({ overrodeRole: "puzzle_number" });
    expect(body).toEqual({
      pick: { kind: "feature", featureId: scoreId },
      overrodeRole: "puzzle_number",
      previewSeen: true,
    });
    expect(JSON.stringify(body)).not.toContain("415");
    expect(Object.keys(body.pick ?? {}).sort()).toEqual(["featureId", "kind"]);
  });

  it("sends I didn't finish with no direction", () => {
    const result = extras({ pick: { kind: "no_result" }, direction: "asc" });
    expect(result.body.pick).toEqual({ kind: "no_result" });
    expect(result.scoreDirection).toBeNull();
  });

  it("sends nothing about a pick when there is none, and no stale role", () => {
    const { body, scoreDirection } = extras({ pick: null, overrodeRole: "date", direction: "asc" });
    expect(body).toEqual({ previewSeen: true });
    expect(scoreDirection).toBeNull();
  });

  it("carries the confirmed direction with a feature pick", () => {
    expect(extras({ direction: "asc" }).scoreDirection).toBe("asc");
  });

  it("records posting here despite a wrong-game warning, and whether a preview was seen", () => {
    expect(extras({ postedHereDespite: "g2", previewSeen: false }).body).toMatchObject({
      wrongGame: { gameId: "g2", choice: "here" },
      previewSeen: false,
    });
  });
});

describe("directionToConfirm — a first teach always asks", () => {
  const feature = local.find((f) => f.id === scoreId) ?? null;

  it("asks when the game is known to have no parser, offering the suggestion", () => {
    expect(directionToConfirm({ feature, hasParser: false, chosen: null })).toBe("desc");
    expect(directionToConfirm({ feature, hasParser: false, chosen: "asc" })).toBe("asc");
  });

  it("asks when nobody has said whether the game has a parser (the preview is late)", () => {
    expect(directionToConfirm({ feature, hasParser: null, chosen: null })).toBe("desc");
  });

  it("does not ask for a game that has a parser, or without a feature pick", () => {
    expect(directionToConfirm({ feature, hasParser: true, chosen: "asc" })).toBeNull();
    expect(directionToConfirm({ feature: null, hasParser: false, chosen: null })).toBeNull();
  });
});

describe("the capability gate", () => {
  const response = (teach: boolean | undefined, hasParser?: boolean): GamesResponse =>
    ({
      periodKey: "2026-10-07",
      games: [
        { gameId: "g1", game: { id: "g1", ...(hasParser === undefined ? {} : { hasParser }) } },
      ],
      ...(teach === undefined ? {} : { capabilities: { recognition: false, teach } }),
    }) as unknown as GamesResponse;

  it("is off unless a cached games response says teach is on", () => {
    expect(teachAvailableIn([])).toBe(false);
    expect(teachAvailableIn([undefined])).toBe(false);
    // A server that predates capabilities, and one that predates `teach`.
    expect(teachAvailableIn([response(undefined)])).toBe(false);
    expect(
      teachAvailableIn([{ ...response(undefined), capabilities: { recognition: true } }]),
    ).toBe(false);
    expect(teachAvailableIn([response(false)])).toBe(false);
    expect(teachAvailableIn([response(false), response(true)])).toBe(true);
  });

  it("allows no teach request without the capability, a session, a game, or text", () => {
    const allowed = { available: true, signedIn: true, gameId: "g1", empty: false };
    expect(teachRequestsAllowed(allowed)).toBe(true);
    expect(teachRequestsAllowed({ ...allowed, available: false })).toBe(false);
    expect(teachRequestsAllowed({ ...allowed, signedIn: false })).toBe(false);
    expect(teachRequestsAllowed({ ...allowed, gameId: null })).toBe(false);
    expect(teachRequestsAllowed({ ...allowed, empty: true })).toBe(false);
  });

  it("reads whether a game has a parser from the games list, or says it does not know", () => {
    expect(listedHasParser([response(true, false)], "g1")).toBe(false);
    expect(listedHasParser([response(true, true)], "g1")).toBe(true);
    expect(listedHasParser([response(true)], "g1")).toBeNull();
    expect(listedHasParser([response(true, true)], "other")).toBeNull();
    expect(listedHasParser([response(true, true)], null)).toBeNull();
  });
});
