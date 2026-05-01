import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "./request.js";
import { ok } from "./response.js";

function appWithSchema(schema: z.ZodType, opts: { allowEmpty?: boolean } = {}) {
  const app = new Hono();
  app.post("/", async (c) => {
    const r = await parseJsonBody(c, schema, opts);
    if (!r.ok) return r.response;
    return ok(c, { data: r.data });
  });
  return app;
}

const userSchema = z.object({ name: z.string() });

describe("parseJsonBody", () => {
  it("returns the parsed body on success", async () => {
    const app = appWithSchema(userSchema);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "kira" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { name: "kira" } });
  });

  it("returns 400 VALIDATION on invalid JSON", async () => {
    const app = appWithSchema(userSchema);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION", error: "invalid json body" });
  });

  it("returns 400 VALIDATION with zod issues on schema failure", async () => {
    const app = appWithSchema(userSchema);
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details: unknown };
    expect(body.code).toBe("VALIDATION");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("with allowEmpty=true, accepts an empty body when schema accepts undefined", async () => {
    const optional = userSchema.optional();
    const app = appWithSchema(optional, { allowEmpty: true });
    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("with allowEmpty=false (default), returns 400 on empty body", async () => {
    const optional = userSchema.optional();
    const app = appWithSchema(optional);
    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(400);
  });
});
