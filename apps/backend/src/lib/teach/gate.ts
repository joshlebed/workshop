import { getConfig } from "../config.js";
import { isGamesBetaUser } from "../gamesBeta.js";

/**
 * Whether teach v2 is on for one user: always for Games beta accounts,
 * otherwise only when both `GAME_TEACH` and `GAME_CODE_PARSING` are `on` —
 * teach corrects what stored code read, so it means nothing for an account
 * the legacy parser still handles. Every teach gate goes through this, never
 * `getConfig().gameTeach` directly. Pass the user the session acts as
 * (`c.get("userId")`), as with `recognitionModeFor`.
 */
export function teachModeFor(userId: string): "off" | "on" {
  if (isGamesBetaUser(userId)) return "on";
  const config = getConfig();
  return config.gameTeach === "on" && config.gameCodeParsing === "on" ? "on" : "off";
}
