// OpenAI Responses API client for the teach flow — one POST, one timeout, no
// retries, structured JSON out. Plain `fetch` for the same reason as
// `lib/jev.ts`: an SDK's default timeout-and-retry policy is the opposite of
// what a 15s Lambda needs. Every caller treats a failure as "carry on without
// the model", so this never throws.

import type { z } from "zod";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface OpenAiUsage {
  inputTokens: number;
  outputTokens: number;
}

export type OpenAiFailureReason =
  /** No `OPENAI_API_KEY`. */
  | "unconfigured"
  /** The call ran past its time budget. */
  | "timeout"
  /** Non-2xx, or the request itself failed. */
  | "http"
  /** 2xx, but the output was cut off, empty, not JSON, or not the asked-for shape. */
  | "invalid";

type OpenAiResult<T> =
  | { ok: true; data: T; usage: OpenAiUsage; durationMs: number; model: string }
  | { ok: false; reason: OpenAiFailureReason; durationMs: number; model: string };

interface OpenAiJsonRequest<T> {
  model: string;
  effort: string;
  instructions: string;
  input: string;
  /** Name + JSON Schema sent as a strict structured-output format. */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** The same shape, validated on the way back in — the trust boundary. */
  schema: z.ZodType<T>;
  /** Hard cap on what one call may generate (and so cost). */
  maxOutputTokens: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function outputText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    const content = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
      if (type === "output_text" && typeof text === "string") return text;
    }
  }
  return null;
}

function usageOf(body: unknown): OpenAiUsage {
  const usage = (body as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)
    ?.usage;
  return {
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
  };
}

/**
 * Ask the model for one JSON object matching `schema`. Returns a failure —
 * never throws — when OpenAI is unconfigured, slow, erroring, or answers with
 * something that does not validate.
 */
export async function openAiJson<T>(request: OpenAiJsonRequest<T>): Promise<OpenAiResult<T>> {
  const { model } = request;
  const startedAt = Date.now();
  const fail = (reason: OpenAiFailureReason): OpenAiResult<T> => ({
    ok: false,
    reason,
    durationMs: Date.now() - startedAt,
    model,
  });
  const apiKey = getConfig().openaiApiKey;
  if (!apiKey) return fail("unconfigured");
  if (request.timeoutMs <= 0) return fail("timeout");
  try {
    const res = await (request.fetchImpl ?? fetch)(RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: request.effort },
        max_output_tokens: request.maxOutputTokens,
        store: false,
        instructions: request.instructions,
        input: request.input,
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!res.ok) {
      logger.warn("openai non-2xx", { status: res.status, model, schema: request.schemaName });
      return fail("http");
    }
    const body: unknown = await res.json();
    const text = outputText(body);
    if (text === null) return fail("invalid");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Cut off at `max_output_tokens`, most likely.
      return fail("invalid");
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      logger.warn("openai output failed validation", {
        error: parsed.error,
        model,
        schema: request.schemaName,
      });
      return fail("invalid");
    }
    return {
      ok: true,
      data: parsed.data,
      usage: usageOf(body),
      durationMs: Date.now() - startedAt,
      model,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.warn("openai call failed", { error, model, schema: request.schemaName, timedOut });
    return fail(timedOut ? "timeout" : "http");
  }
}
