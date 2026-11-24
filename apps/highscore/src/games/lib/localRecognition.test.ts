import { type GameRecognizer, recognizerEvidence } from "@workshop/shared/gameRecognition";
import type { GamesResponse } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
  localScoreRead,
  parseStoredRecognizers,
  recognitionCapability,
  recognizeLocally,
  recognizersOutOfDate,
  serializeRecognizers,
} from "./localRecognition";

const mini = (date: string, time: string) =>
  `I solved the ${date} New York Times Mini Crossword in ${time}!`;

function recognizer(
  id: string,
  title: string,
  normalizedUrl: string,
  extra: Partial<GameRecognizer> = {},
  examples: string[] = [],
): GameRecognizer {
  return {
    id,
    title,
    url: `https://${normalizedUrl}`,
    normalizedUrl,
    parser: null,
    scoreUnit: null,
    ...recognizerEvidence(examples),
    ...extra,
  };
}

const krillion = recognizer("k", "Krillion · the daily dive", "krillion.io");
const nytMini = recognizer("m", "NYT Mini", "nytimes.com/crosswords/game/mini", {}, [
  mini("5/20/2026", "0:16"),
  mini("5/21/2026", "1:02"),
  mini("5/22/2026", "0:48"),
]);
const dailyTens = recognizer("d", "Daily Tens", "dailytens.com");
const all = [krillion, nytMini, dailyTens];
const NOW = Date.UTC(2026, 10, 15);
const DAY = 24 * 60 * 60_000;

describe("recognizeLocally", () => {
  it("names the game with no request, for a link, a name or a shape", () => {
    expect(recognizeLocally("Krillion #77 🦐\n305", all, null)).toEqual({
      game: { id: "k", title: "Krillion · the daily dive", url: "https://krillion.io" },
      inMyGames: true,
      confidence: 0.97,
      method: "label",
      parser: null,
      scoreUnit: null,
    });
    expect(recognizeLocally(mini("6/01/2026", "0:13"), all, null)).toMatchObject({
      game: { id: "m" },
      method: "fingerprint",
    });
  });

  it("is null without recognizers, and for a text it cannot place", () => {
    expect(recognizeLocally("Krillion #77 🦐\n305", null, null)).toBeNull();
    expect(recognizeLocally("Krillion #77 🦐\n305", [], null)).toBeNull();
    expect(recognizeLocally("98🎯 95🏅\nFinal score: 947", all, null)).toBeNull();
    expect(recognizeLocally("", all, null)).toBeNull();
  });

  it("does not claim a share that is only the game's link", () => {
    expect(recognizeLocally("https://dailytens.com/?ref=abc123", all, null)).toBeNull();
  });

  it("says the game is in My Games until the live list says otherwise", () => {
    const share = "Daily Tens #40 7/10 🏆";
    // Recognizers are My Games as of when they were built.
    expect(recognizeLocally(share, all, null)).toMatchObject({ inMyGames: true });
    expect(recognizeLocally(share, all, new Set(["k", "m", "d"]))).toMatchObject({
      game: { id: "d" },
      inMyGames: true,
    });
    // Removed since: posting adds it back.
    expect(recognizeLocally(share, all, new Set(["k", "m"]))).toMatchObject({ inMyGames: false });
  });

  it("knows nothing about a game the player has not added", () => {
    expect(recognizeLocally("Wordle 1,127 3/6\n⬜🟨⬜⬜⬜", all, null)).toBeNull();
  });
});

describe("reading the score on the device", () => {
  it("hands the match the game's parse code and unit when the recognizer has them", () => {
    const parser = { code: "function parse(raw) { return 1; }", version: 3 };
    const timed = recognizer("t", "Timed Game", "timed.example", { parser, scoreUnit: "seconds" });
    expect(recognizeLocally("Timed Game #4 0:42", [timed], null)).toMatchObject({
      game: { id: "t" },
      parser,
      scoreUnit: "seconds",
    });
  });

  it("shows a score or a loss, and nothing for a text the code could not read", () => {
    expect(localScoreRead({ kind: "score", value: 402 }, null)).toEqual({
      kind: "score",
      value: 402,
      unit: null,
    });
    expect(localScoreRead({ kind: "score", value: 42 }, "seconds")).toMatchObject({
      unit: "seconds",
    });
    expect(localScoreRead({ kind: "noResult" }, null)).toEqual({ kind: "no_result" });
    // A failure is not "no score": the server decides, and may open the picker.
    expect(localScoreRead({ kind: "failed", reason: "threw" }, null)).toBeNull();
    expect(localScoreRead({ kind: "failed", reason: "timeout" }, null)).toBeNull();
  });
});

describe("stored recognizers", () => {
  it("round-trips for the account that saved them", () => {
    const raw = serializeRecognizers("user-1", all, NOW);
    expect(parseStoredRecognizers(raw, "user-1", NOW + DAY)).toEqual({
      savedAt: NOW,
      recognizers: all,
    });
  });

  it("is nothing for another account, an old or future entry, or junk", () => {
    const raw = serializeRecognizers("user-1", all, NOW);
    expect(parseStoredRecognizers(raw, "user-2", NOW)).toBeNull();
    expect(parseStoredRecognizers(raw, "user-1", NOW + 31 * DAY)).toBeNull();
    expect(parseStoredRecognizers(raw, "user-1", NOW - DAY)).toBeNull();
    expect(parseStoredRecognizers(null, "user-1", NOW)).toBeNull();
    expect(parseStoredRecognizers("{not json", "user-1", NOW)).toBeNull();
    expect(
      parseStoredRecognizers(JSON.stringify({ v: 0, userId: "user-1" }), "user-1", NOW),
    ).toBeNull();
    const wrongShape = JSON.stringify({ v: 1, userId: "user-1", savedAt: NOW, recognizers: [{}] });
    expect(parseStoredRecognizers(wrongShape, "user-1", NOW)).toBeNull();
  });
});

describe("recognitionCapability", () => {
  const response = (recognition?: boolean): GamesResponse => ({
    periodKey: "2026-11-15",
    games: [],
    ...(recognition === undefined
      ? {}
      : { capabilities: { recognition, codeParsing: true, teach: true } }),
  });

  it("is unknown until a games response has arrived", () => {
    expect(recognitionCapability([])).toBeNull();
    expect(recognitionCapability([undefined])).toBeNull();
  });

  it("is what the server said once one has", () => {
    expect(recognitionCapability([undefined, response(true)])).toBe(true);
    expect(recognitionCapability([response(false)])).toBe(false);
    // A server that predates capabilities: all off.
    expect(recognitionCapability([response()])).toBe(false);
  });
});

describe("recognizersOutOfDate", () => {
  it("is true only when My Games differs from what they were built for", () => {
    expect(recognizersOutOfDate(all, new Set(["k", "m", "d"]))).toBe(false);
    // A game added since, one removed since, one swapped.
    expect(recognizersOutOfDate(all, new Set(["k", "m", "d", "x"]))).toBe(true);
    expect(recognizersOutOfDate(all, new Set(["k", "m"]))).toBe(true);
    expect(recognizersOutOfDate(all, new Set(["k", "m", "x"]))).toBe(true);
  });
});
