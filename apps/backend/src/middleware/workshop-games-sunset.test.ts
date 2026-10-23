import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  requestClientContextFromHeaders,
  runWithRequestClientContext,
} from "../lib/requestContext.js";
import { WORKSHOP_GAMES_SUNSET_MS, workshopGamesSunset } from "./workshop-games-sunset.js";

function buildApp(now: number) {
  const app = new Hono();
  // Stand-in for `requestLog`, which enters the client context in prod.
  app.use("*", (c, next) =>
    runWithRequestClientContext(
      requestClientContextFromHeaders((name) => c.req.header(name)),
      () => next(),
    ),
  );
  app.use(
    "*",
    workshopGamesSunset(() => now),
  );
  app.get("/v1/games", (c) => c.json({ ok: true }));
  return app;
}

const BEFORE = WORKSHOP_GAMES_SUNSET_MS - 1;
const AFTER = WORKSHOP_GAMES_SUNSET_MS;

describe("workshopGamesSunset", () => {
  it("lets Workshop through before the sunset", async () => {
    const res = await buildApp(BEFORE).request("/v1/games", {
      headers: { "X-Workshop-Client": "workshop" },
    });
    expect(res.status).toBe(200);
  });

  it("410s Workshop from the sunset instant, pointing at HighScore", async () => {
    const res = await buildApp(AFTER).request("/v1/games", {
      headers: { "X-Workshop-Client": "workshop" },
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as {
      code: string;
      details: { highscoreUrl: string; appStoreUrl: string };
    };
    expect(body.code).toBe("GONE");
    expect(body.details.highscoreUrl).toBe("https://highscore.live");
    expect(body.details.appStoreUrl).toContain("apps.apple.com");
  });

  it("never touches HighScore, header-less, or unknown clients", async () => {
    const app = buildApp(AFTER);
    for (const headers of [
      { "X-Workshop-Client": "highscore" },
      {},
      { "X-Workshop-Client": "something-else" },
    ]) {
      const res = await app.request("/v1/games", { headers });
      expect(res.status).toBe(200);
    }
  });
});
