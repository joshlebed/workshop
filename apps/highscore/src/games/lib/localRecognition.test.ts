import { type GameRecognizer, recognizerEvidence } from "@workshop/shared/gameRecognition";
import type { GamesResponse } from "@workshop/shared/games";
import { describe, expect, it } from "vitest";
import {
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
    inMyGames: true,
    curated: false,
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
const dailyTens = recognizer("d", "Daily Tens", "dailytens.com", {
  inMyGames: false,
  curated: true,
});
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

  it("takes inMyGames from the live list once it has loaded", () => {
    const share = "Daily Tens #40 7/10 🏆";
    expect(recognizeLocally(share, all, null)).toMatchObject({ inMyGames: false });
    // Added since the recognizers were built: post straight to its row.
    expect(recognizeLocally(share, all, new Set(["k", "m", "d"]))).toMatchObject({
      game: { id: "d" },
      inMyGames: true,
    });
    // Removed since: posting adds it back.
    expect(recognizeLocally("Krillion #77 🦐\n305", all, new Set(["m"]))).toMatchObject({
      inMyGames: false,
    });
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
    expect(recognizersOutOfDate(all, new Set(["k", "m"]))).toBe(false);
    expect(recognizersOutOfDate(all, new Set(["k", "m", "d"]))).toBe(true);
    expect(recognizersOutOfDate(all, new Set(["k"]))).toBe(true);
    expect(recognizersOutOfDate(all, new Set(["k", "x"]))).toBe(true);
  });
});
