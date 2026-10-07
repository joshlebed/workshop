// The server score preview, driven the way the hook drives it — a real
// QueryClient and observer, with only the network call replaced — for the
// three situations the paste sheet has to get right: an account without the
// feature (no request at all), an answer still in flight (no caption), and a
// failed request (the local caption, silently).

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { GameScorePreview, GamesResponse } from "@workshop/shared/games";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const previewGameScore =
  vi.fn<
    (
      gameId: string,
      scoreRaw: string,
      token: string | null,
      signal?: AbortSignal,
    ) => Promise<GameScorePreview | null>
  >();
vi.mock("../api/games", () => ({
  previewGameScore: (
    gameId: string,
    scoreRaw: string,
    token: string | null,
    signal?: AbortSignal,
  ) => previewGameScore(gameId, scoreRaw, token, signal),
}));

import {
  codeParsingAvailable,
  pasteSheetCaption,
  type ServerScorePreview,
  scorePreviewOffered,
  scorePreviewQueryOptions,
  serverScorePreviewState,
} from "./scorePreview";
import { previewScore } from "./scoreSpecs";

const WORLDLE = "#Worldle #1663 (11.08.2026) 5/6 (100%)\n🟩🟩⬜⬜⬜↘️\n🟩🟩🟩🟩🟩🎉";
// What the client's own (legacy) Worldle rule makes of that share: nothing.
const worldleSpec = {
  rules: [{ kind: "capture" as const, pattern: "Worldle\\s*#?\\d+\\s+(\\d+)/6" }],
};
const local = previewScore(WORLDLE, worldleSpec);
const LOCAL_CAPTION = "Couldn't read a score in this. It'll post as “Played”.";

let queryClient: QueryClient;

function gamesResponse(capabilities?: GamesResponse["capabilities"]): GamesResponse {
  return { periodKey: "2026-10-07", games: [], ...(capabilities ? { capabilities } : {}) };
}

/**
 * One pass of what `useScorePreview` does for a settled draft: decide whether
 * to ask, subscribe the query, and report the state the sheet would see now.
 */
function observe(text: string, opts: { gameId?: string | null; token?: string | null } = {}) {
  const gameId = opts.gameId === undefined ? "game-1" : opts.gameId;
  const token = opts.token === undefined ? "token" : opts.token;
  const offered = scorePreviewOffered({
    available: codeParsingAvailable(queryClient),
    token,
    gameId,
    text,
  });
  const observer = new QueryObserver(
    queryClient,
    scorePreviewQueryOptions({ offered, token, gameId, settledText: text }),
  );
  const unsubscribe = observer.subscribe(() => {});
  const state = (): ServerScorePreview => {
    const result = observer.getCurrentResult();
    return serverScorePreviewState({
      offered,
      text,
      settledText: text,
      isPending: result.isPending,
      data: result.data,
    });
  };
  const caption = () =>
    pasteSheetCaption({ server: state(), local, empty: false, showTeach: false });
  return { state, caption, unsubscribe };
}

/** Let the query function's promise and the observer's notification run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  queryClient = new QueryClient();
  previewGameScore.mockReset();
});

afterEach(() => {
  queryClient.clear();
});

describe("an account without code parsing", () => {
  it.each([
    ["the server says it is off", gamesResponse({ recognition: true, codeParsing: false })],
    ["the server predates the capability", gamesResponse({ recognition: false })],
    ["the server sent no capabilities at all", gamesResponse()],
  ])("makes no preview request when %s", async (_label, response) => {
    queryClient.setQueryData(["games", "mine", "2026-10-07"], response);
    const sheet = observe(WORLDLE);
    await settle();

    expect(previewGameScore).not.toHaveBeenCalled();
    expect(sheet.state()).toEqual({ state: "unavailable" });
    // The caption is the one the sheet has always shown.
    expect(sheet.caption()).toBe(LOCAL_CAPTION);
    sheet.unsubscribe();
  });

  it("makes no request before the games list has loaded", async () => {
    const sheet = observe(WORLDLE);
    await settle();
    expect(previewGameScore).not.toHaveBeenCalled();
    expect(sheet.caption()).toBe(LOCAL_CAPTION);
    sheet.unsubscribe();
  });
});

describe("an account with code parsing", () => {
  beforeEach(() => {
    queryClient.setQueryData(
      ["games", "mine", "2026-10-07"],
      gamesResponse({ recognition: false, codeParsing: true }),
    );
  });

  it("shows no caption while the answer is in flight, then the server's reading", async () => {
    let answer: (preview: GameScorePreview) => void = () => {};
    previewGameScore.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const sheet = observe(WORLDLE);
    await settle();

    expect(previewGameScore).toHaveBeenCalledTimes(1);
    expect(previewGameScore.mock.calls[0]?.slice(0, 3)).toEqual(["game-1", WORLDLE, "token"]);
    expect(sheet.state()).toEqual({ state: "pending" });
    // Not the local parser's "couldn't read": for this account that would be
    // wrong — the server reads a 5.
    expect(sheet.caption()).toBe(null);

    answer({ parseStatus: "score", scoreValue: 5, scoreSummary: "🟩 2·5 5/6" });
    await settle();
    expect(sheet.state()).toMatchObject({ state: "ready", preview: { scoreValue: 5 } });
    expect(sheet.caption()).toBe("Recording score: 5");
    sheet.unsubscribe();
  });

  it("falls back to the local caption, silently and without retrying, when the endpoint errors", async () => {
    previewGameScore.mockRejectedValue(new Error("502 from the API"));
    const sheet = observe(WORLDLE);
    expect(sheet.caption()).toBe(null);
    await settle();

    expect(previewGameScore).toHaveBeenCalledTimes(1);
    expect(sheet.state()).toEqual({ state: "unavailable" });
    expect(sheet.caption()).toBe(LOCAL_CAPTION);
    sheet.unsubscribe();
  });

  it("treats a response that is not a preview the same as an error", async () => {
    // `previewGameScore` returns null when the body fails validation.
    previewGameScore.mockResolvedValue(null);
    const sheet = observe(WORLDLE);
    await settle();
    expect(sheet.state()).toEqual({ state: "unavailable" });
    expect(sheet.caption()).toBe(LOCAL_CAPTION);
    sheet.unsubscribe();
  });

  it("says a loss ranks last and an unread share has no rank", async () => {
    previewGameScore.mockResolvedValueOnce({
      parseStatus: "no_result",
      scoreValue: null,
      scoreSummary: "🟩 3 X/6",
    });
    const loss = observe("#Worldle #1 X/6");
    await settle();
    expect(loss.caption()).toBe("No score today. This posts and ranks last.");
    loss.unsubscribe();

    previewGameScore.mockResolvedValueOnce({
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "hi",
    });
    const unread = observe("hi");
    await settle();
    expect(unread.caption()).toBe("Couldn't read a score in this. It'll post without a rank.");
    unread.unsubscribe();
  });

  it("asks nothing for an empty draft, a signed-out session or a target with no game id", async () => {
    for (const sheet of [
      observe(""),
      observe(WORLDLE, { token: null }),
      observe(WORLDLE, { gameId: null }),
    ]) {
      await settle();
      expect(sheet.state()).toEqual({ state: "unavailable" });
      sheet.unsubscribe();
    }
    expect(previewGameScore).not.toHaveBeenCalled();
  });
});

describe("serverScorePreviewState", () => {
  const ready: GameScorePreview = { parseStatus: "score", scoreValue: 5, scoreSummary: null };

  it("ignores an answer for a draft that is no longer on screen", () => {
    // The user kept typing: the query still holds the previous draft's answer.
    expect(
      serverScorePreviewState({
        offered: true,
        text: "Wordle 1,127 4/6",
        settledText: "Wordle 1,127 3/6",
        isPending: false,
        data: ready,
      }),
    ).toEqual({ state: "pending" });
  });

  it("is unavailable, whatever the cache holds, when the preview is not offered", () => {
    expect(
      serverScorePreviewState({
        offered: false,
        text: "x",
        settledText: "x",
        isPending: false,
        data: ready,
      }),
    ).toEqual({ state: "unavailable" });
  });
});

describe("pasteSheetCaption", () => {
  const pending: ServerScorePreview = { state: "pending" };
  const unavailable: ServerScorePreview = { state: "unavailable" };

  it("shows nothing for an empty draft or while the teach chips are up", () => {
    expect(pasteSheetCaption({ server: unavailable, local, empty: true, showTeach: false })).toBe(
      null,
    );
    expect(pasteSheetCaption({ server: unavailable, local, empty: false, showTeach: true })).toBe(
      null,
    );
  });

  it("shows nothing while pending even though a local caption exists", () => {
    expect(local).not.toBe(null);
    expect(pasteSheetCaption({ server: pending, local, empty: false, showTeach: false })).toBe(
      null,
    );
  });
});
