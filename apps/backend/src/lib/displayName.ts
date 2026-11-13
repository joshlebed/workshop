// The one rule for `users.display_name`. Every stored value is NULL (the user
// hasn't picked a name yet → `needsDisplayName: true` → HighScore's
// `/onboarding/display-name`) or a string that passes `displayNameSchema`.
// The `users_display_name_check` CHECK constraint (migration 0059) is the
// database backstop: non-blank and ≤ 40 characters.
//
// Two entry points:
// - `displayNameSchema` — a name the user typed (`PATCH /v1/users/me`).
//   Invalid input is a 400 the user can fix.
// - `normalizeProviderDisplayName` — a name an identity provider or a client
//   relayed at sign-in (Apple `fullName`, Google `name`, dev sign-in). The user
//   never typed it here, so a bad one must not fail the sign-in: it becomes
//   NULL and onboarding asks for a name. Every sign-up path goes through it.

import { z } from "zod";
import { containsObjectionableContent, OBJECTIONABLE_CONTENT_MESSAGE } from "./contentFilter.js";

const DISPLAY_NAME_MAX_CHARS = 40;

// Display names: stripped, 1–40 chars, no leading/trailing whitespace,
// no embedded newlines. Permissive on character set — emoji + non-Latin OK.
// `max` counts UTF-16 code units, so it is never looser than the DB's
// `char_length` (code points).
export const displayNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z.string().min(1, "display name required").max(DISPLAY_NAME_MAX_CHARS, "display name too long"),
  )
  .refine((s) => !/[\r\n]/.test(s), "display name must be a single line")
  // Guideline 1.2: names are the most-seen user content on a leaderboard.
  .refine((s) => !containsObjectionableContent(s), OBJECTIONABLE_CONTENT_MESSAGE);

/**
 * A provider-supplied name → a valid display name, or null. Line breaks
 * become a single space, then the result must pass `displayNameSchema`
 * (trimmed, non-empty, ≤ 40, content filter). Never truncates: a name that
 * doesn't fit is dropped so the user picks one in onboarding.
 */
export function normalizeProviderDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parsed = displayNameSchema.safeParse(raw.replace(/[\r\n]+/g, " "));
  return parsed.success ? parsed.data : null;
}
