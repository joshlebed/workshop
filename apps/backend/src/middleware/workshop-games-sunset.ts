import {
  HIGHSCORE_APP_STORE_URL,
  HIGHSCORE_WEB_URL,
  WORKSHOP_GAMES_SUNSET_AT,
} from "@workshop/shared/constants";
import type { MiddlewareHandler } from "hono";
import { getRequestClientContext } from "../lib/requestContext.js";
import { err } from "../lib/response.js";

export const WORKSHOP_GAMES_SUNSET_MS = Date.parse(WORKSHOP_GAMES_SUNSET_AT);

/**
 * From `WORKSHOP_GAMES_SUNSET_AT`, the Workshop client no longer gets games.
 * Updated Workshop bundles never call these routes after the sunset (they
 * render the HighScore hand-off instead); this backstop covers any install
 * that missed the OTA, so a stale Workshop build fails loudly with a pointer
 * to HighScore rather than quietly diverging from it. Identity comes from the
 * validated `X-Workshop-Client` header — HighScore, pre-header clients, and
 * scripts are untouched.
 */
export function workshopGamesSunset(now: () => number = Date.now): MiddlewareHandler {
  return async (c, next) => {
    if (getRequestClientContext()?.client === "workshop" && now() >= WORKSHOP_GAMES_SUNSET_MS) {
      return err(c, "GONE", "Daily games moved to HighScore", {
        highscoreUrl: HIGHSCORE_WEB_URL,
        appStoreUrl: HIGHSCORE_APP_STORE_URL,
        sunsetAt: WORKSHOP_GAMES_SUNSET_AT,
      });
    }
    await next();
  };
}
