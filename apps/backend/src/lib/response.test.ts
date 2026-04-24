import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { err, ok } from "./response.js";

describe("response envelope", () => {
  it("ok returns the resource directly with status 200", async () => {
    const app = new Hono();
    app.get("/", (c) => ok(c, { item: { id: "x" } }));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ item: { id: "x" } });
  });

  it("ok respects custom status", async () => {
    const app = new Hono();
    app.post("/", (c) => ok(c, { item: { id: "x" } }, 201));
    const res = await app.request("/", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("err maps known codes to default statuses and emits stable shape", async () => {
    const app = new Hono();
    app.get("/u", (c) => err(c, "UNAUTHORIZED", "nope"));
    app.get("/v", (c) => err(c, "VALIDATION", "bad", { field: "title" }));
    app.get("/r", (c) => err(c, "RATE_LIMITED", "slow down"));

    const u = await app.request("/u");
    expect(u.status).toBe(401);
    expect(await u.json()).toEqual({ error: "nope", code: "UNAUTHORIZED" });

    const v = await app.request("/v");
    expect(v.status).toBe(400);
    expect(await v.json()).toEqual({
      error: "bad",
      code: "VALIDATION",
      details: { field: "title" },
    });

    const r = await app.request("/r");
    expect(r.status).toBe(429);
  });

  it("err allows status override", async () => {
    const app = new Hono();
    app.get("/", (c) => err(c, "INTERNAL", "boom", undefined, 503));
    const res = await app.request("/");
    expect(res.status).toBe(503);
  });
});
