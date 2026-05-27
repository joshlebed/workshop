import type { ModuleName } from "@workshop/shared/modules";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireModule, stripModuleGatedItemFields } from "./moduleGate.js";

// Build a tiny Hono app that exercises `requireModule` for each module.
// Avoids the route-test harness and keeps the assertion focused on the
// gate's response shape.
function gateApp(modules: readonly ModuleName[], gateOn: ModuleName) {
  const app = new Hono();
  app.post("/probe", (c) => {
    const blocked = requireModule(c, modules, gateOn);
    if (blocked) return blocked;
    return c.json({ ok: true });
  });
  return app;
}

describe("requireModule — 409 contract per §5.1", () => {
  const allModules: readonly ModuleName[] = ["todo", "ranking", "leaderboard", "sources"];

  for (const m of allModules) {
    it(`returns 409 with code "${m}.disabled" when ${m} is off`, async () => {
      const app = gateApp([], m);
      const res = await app.request("/probe", { method: "POST" });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        code: string;
        details: { code: string; module: string; message: string };
      };
      expect(body.code).toBe("CONFLICT");
      expect(body.details.code).toBe(`${m}.disabled`);
      expect(body.details.module).toBe(m);
      expect(typeof body.details.message).toBe("string");
      expect(body.details.message.length).toBeGreaterThan(0);
    });

    it(`returns null and lets the handler run when ${m} is on`, async () => {
      const app = gateApp([m], m);
      const res = await app.request("/probe", { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  }

  it("treats unrelated modules as not enabling the gate", async () => {
    const app = gateApp(["ranking", "sources"], "todo");
    const res = await app.request("/probe", { method: "POST" });
    expect(res.status).toBe(409);
  });
});

describe("stripModuleGatedItemFields", () => {
  const fullItem = {
    id: "1",
    title: "x",
    completed: false,
    completedAt: null,
    completedBy: null,
    position: 1024,
  };

  it("returns every field when all relevant modules are on", () => {
    const out = stripModuleGatedItemFields(fullItem, ["todo", "ranking"]);
    expect(out).toEqual(fullItem);
  });

  it("drops completed* fields when todo is off", () => {
    const out = stripModuleGatedItemFields(fullItem, ["ranking"]);
    expect(out).not.toHaveProperty("completed");
    expect(out).not.toHaveProperty("completedAt");
    expect(out).not.toHaveProperty("completedBy");
    expect(out).toMatchObject({ position: 1024 });
  });

  it("drops position when ranking is off", () => {
    const out = stripModuleGatedItemFields(fullItem, ["todo"]);
    expect(out).not.toHaveProperty("position");
    expect(out).toMatchObject({ completed: false });
  });

  it("doesn't mutate the input", () => {
    const cloned = { ...fullItem };
    stripModuleGatedItemFields(cloned, []);
    expect(cloned).toEqual(fullItem);
  });

  it("strips everything gated when no modules are on", () => {
    const out = stripModuleGatedItemFields(fullItem, []);
    expect(out).toEqual({ id: "1", title: "x" });
  });
});
