import type { Context } from "hono";
import type { z } from "zod";
import { err } from "./response.js";

/**
 * Read a JSON body, validate it against a zod schema, and return either the
 * parsed value or a populated v1 error envelope. Centralises the
 * `try { c.req.json() } catch ...; safeParse(); if (!success) ...` boilerplate
 * that every mutating route was repeating.
 *
 * Set `allowEmpty: true` for endpoints that accept an empty body (e.g.
 * `POST /v1/lists/:id/invites` and `POST /v1/activity/read`); the schema must
 * itself accept `undefined` in that mode.
 */
export async function parseJsonBody<T extends z.ZodType>(
  c: Context,
  schema: T,
  opts: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    if (opts.allowEmpty) {
      const text = await c.req.text();
      body = text.length === 0 ? undefined : JSON.parse(text);
    } else {
      body = await c.req.json();
    }
  } catch {
    return { ok: false, response: err(c, "VALIDATION", "invalid json body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: err(c, "VALIDATION", "invalid request", parsed.error.issues) };
  }
  return { ok: true, data: parsed.data };
}
