// Request schemas shared by the Lists score routes (routes/v1/scores.ts) and
// the Games score routes (routes/v1/games.ts) — one definition, not two
// drifting copies.

import { z } from "zod";

export const periodKeySchema = z
  .string()
  .min(1, "periodKey required")
  .max(64, "periodKey too long")
  .refine((s) => /^[A-Za-z0-9_\-:.]+$/.test(s), "periodKey contains invalid characters");

export const scoreRawSchema = z.string().min(1, "scoreRaw required").max(2000, "scoreRaw too long");

export const upsertScoreSchema = z.object({
  periodKey: periodKeySchema,
  scoreRaw: scoreRawSchema,
});
