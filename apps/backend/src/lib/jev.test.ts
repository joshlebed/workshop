import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildRecognitionChoice, systemOne } from "./jev.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

const question = { type: "noul", instructions: "Is this urgent?" } as const;
const okBody = {
  model: "jev-1.13.0",
  answers: { q: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 1 },
};
const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("systemOne", () => {
  it("posts the pinned model with a bearer key and returns the validated answers", async () => {
    const fetchImpl = respond(200, okBody);
    const result = await systemOne("help", { q: question }, { apiKey: "k", fetchImpl });
    expect(result?.answers.q).toEqual({ type: "noul", noul: 0.9 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "jev-1.13.0",
      state: "help",
      questions: { q: question },
    });
  });

  it("does not call out when no API key is configured", async () => {
    const fetchImpl = respond(200, okBody);
    expect(await systemOne("help", { q: question }, { apiKey: "", fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a non-2xx, a malformed body, a network error and a timeout", async () => {
    const options = { apiKey: "k" };
    expect(
      await systemOne("x", { q: question }, { ...options, fetchImpl: respond(529, {}) }),
    ).toBeNull();
    expect(
      await systemOne("x", { q: question }, { ...options, fetchImpl: respond(200, { nope: 1 }) }),
    ).toBeNull();
    const throwing = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await systemOne("x", { q: question }, { ...options, fetchImpl: throwing })).toBeNull();
    const hanging = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    expect(
      await systemOne("x", { q: question }, { ...options, fetchImpl: hanging, timeoutMs: 20 }),
    ).toBeNull();
  });
});

describe("buildRecognitionChoice", () => {
  it("offers each game as a positional option plus none, and maps options back to ids", () => {
    const {
      state,
      question: choice,
      optionToGameId,
    } = buildRecognitionChoice({
      text: "Final score: 947",
      games: [
        { id: "uuid-a", name: "MapTap", url: "maptap.gg", examples: ["Final score: 770"] },
        { id: "uuid-b", name: "Satle", url: "satle.ca", examples: [] },
      ],
    });
    expect(state).toEqual({ pasted_text: "Final score: 947" });
    expect(choice.type).toBe("choice");
    expect(Object.keys(choice.criteria ?? {})).toEqual(["game_1", "game_2", "none"]);
    expect((choice.criteria as Record<string, unknown>).game_1).toEqual({
      name: "MapTap",
      url: "maptap.gg",
      example_scores: ["Final score: 770"],
    });
    expect([...optionToGameId]).toEqual([
      ["game_1", "uuid-a"],
      ["game_2", "uuid-b"],
    ]);
  });
});
