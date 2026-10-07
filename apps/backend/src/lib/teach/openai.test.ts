import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetConfigForTesting } from "../config.js";
import { openAiJson } from "./openai.js";

const schema = z.object({ code: z.string() });
const request = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
  openAiJson({
    model: "gpt-test",
    effort: "none",
    instructions: "write code",
    input: "example",
    schemaName: "score_parser",
    jsonSchema: { type: "object" },
    schema,
    maxOutputTokens: 900,
    timeoutMs,
    fetchImpl,
  });

const answering = (text: string, usage = { input_tokens: 10, output_tokens: 5 }) =>
  vi.fn(async () =>
    Response.json({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
      usage,
    }),
  ) as unknown as typeof fetch;

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  resetConfigForTesting();
});

describe("openAiJson", () => {
  it("returns the validated object and the token usage", async () => {
    const fetchImpl = answering('{"code":"function parse(raw) {}"}');
    const result = await request(fetchImpl);
    expect(result).toMatchObject({
      ok: true,
      data: { code: "function parse(raw) {}" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("sends a strict JSON schema, a token cap, the effort, and store: false", async () => {
    const fetchImpl = answering('{"code":"x"}');
    await request(fetchImpl);
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-test",
      reasoning: { effort: "none" },
      max_output_tokens: 900,
      store: false,
      text: { format: { type: "json_schema", name: "score_parser", strict: true } },
    });
  });

  it("never calls out without a key", async () => {
    process.env.OPENAI_API_KEY = "";
    resetConfigForTesting();
    const fetchImpl = answering('{"code":"x"}');
    expect(await request(fetchImpl)).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a non-2xx as a failure, not an exception", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("no", { status: 429 }),
    ) as unknown as typeof fetch;
    expect(await request(fetchImpl)).toMatchObject({ ok: false, reason: "http" });
  });

  it("reports a call that outlives its budget as a timeout", async () => {
    const slow = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const result = await request(slow, 30);
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("rejects output that is cut off, not JSON, or not the asked-for shape", async () => {
    for (const text of [
      '{"code":"function parse(raw) { ret',
      "sure, here you go",
      '{"program":"x"}',
    ]) {
      expect(await request(answering(text)), text).toMatchObject({ ok: false, reason: "invalid" });
    }
    const empty = vi.fn(async () => Response.json({ output: [] })) as unknown as typeof fetch;
    expect(await request(empty)).toMatchObject({ ok: false, reason: "invalid" });
  });
});
