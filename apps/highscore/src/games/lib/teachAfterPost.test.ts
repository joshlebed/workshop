import type { ScoreTeachHint, TeachParserResponse } from "@workshop/shared/games";
import { beforeEach, describe, expect, it, vi } from "vitest";

const teachParser = vi.fn<
  (gameId: string, body: Record<string, unknown>, token: string | null) => Promise<unknown>
>(async () => ({ outcome: "accepted" }));
vi.mock("../api/teach", () => ({
  teachParser: (gameId: string, body: Record<string, unknown>, token: string | null) =>
    teachParser(gameId, body, token),
}));

import { teachAfterPost, teachOutcomeMessage } from "./teachAfterPost";

const hint = (over: Partial<ScoreTeachHint> = {}): ScoreTeachHint => ({
  eligible: true,
  needsDirection: true,
  suggestedDirection: "desc",
  ...over,
});
const askDirection = vi.fn(async () => "asc" as const);
const run = (over: Partial<Parameters<typeof teachAfterPost>[0]> = {}) =>
  teachAfterPost({
    gameId: "g1",
    periodKey: "2026-10-07",
    hint: hint(),
    scoreDirection: null,
    askDirection,
    token: "t",
    ...over,
  });

beforeEach(() => {
  teachParser.mockClear();
  askDirection.mockClear();
});

describe("teachAfterPost", () => {
  it("forwards the direction the user confirmed in the picker, without asking again", async () => {
    await run({ scoreDirection: "asc" });
    expect(teachParser).toHaveBeenCalledWith(
      "g1",
      { periodKey: "2026-10-07", scoreDirection: "asc" },
      "t",
    );
    expect(askDirection).not.toHaveBeenCalled();
  });

  it("asks when a first teach has no confirmed direction — the suggestion is never sent as a choice", async () => {
    await run({ scoreDirection: null });
    expect(askDirection).toHaveBeenCalledWith("desc");
    // The user answered lower-is-better; the suggestion was higher.
    expect(teachParser.mock.calls[0]?.[1]).toEqual({
      periodKey: "2026-10-07",
      scoreDirection: "asc",
    });
  });

  it("sends no direction when the game already has a parser", async () => {
    await run({ hint: hint({ needsDirection: false }), scoreDirection: "asc" });
    expect(teachParser.mock.calls[0]?.[1]).toEqual({ periodKey: "2026-10-07" });
    expect(askDirection).not.toHaveBeenCalled();
  });

  it("does nothing when the pick cannot teach", async () => {
    expect(await run({ hint: hint({ eligible: false }) })).toBeNull();
    expect(await run({ hint: undefined })).toBeNull();
    expect(teachParser).not.toHaveBeenCalled();
    expect(askDirection).not.toHaveBeenCalled();
  });

  it("never throws: a failed teach is just no result", async () => {
    teachParser.mockRejectedValueOnce(new Error("network"));
    expect(await run({ scoreDirection: "desc" })).toBeNull();
  });
});

describe("teachOutcomeMessage", () => {
  const result = (outcome: TeachParserResponse["outcome"]) => ({ outcome }) as TeachParserResponse;

  it("speaks only when the game changed or a conflict was recorded", () => {
    expect(teachOutcomeMessage(result("accepted"), "Krillion")).toContain("Krillion scores");
    expect(teachOutcomeMessage(result("switched"), "Krillion")).toContain("Krillion scores");
    expect(teachOutcomeMessage(result("conflict"), "Krillion")).toContain("Someone else");
    for (const quiet of ["rejected", "unavailable", "not_needed", "not_eligible"] as const) {
      expect(teachOutcomeMessage(result(quiet), "Krillion")).toBeNull();
    }
    expect(teachOutcomeMessage(null, "Krillion")).toBeNull();
  });
});
