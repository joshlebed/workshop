// PROTOTYPE — generated share formatters (`capabilities.formatterPreview` on
// `GET /v1/games`). Every endpoint 404s for an account without it, so check
// `formatterPreviewAvailable` first. Responses are zod-validated; a preview or
// suggestion that fails validation resolves to null — a hint must never be
// the thing that breaks posting.

import { apiRequest } from "@workshop/api-client/api";
import type { Game } from "@workshop/shared/games";
import { z } from "zod";

const candidateSchema = z.object({
  kind: z.enum(["heuristic", "llm"]),
  summaries: z.array(z.string().nullable()),
});

const previewSchema = z.object({
  hasFormatter: z.boolean(),
  samples: z.array(
    z.object({
      periodKey: z.string().nullable(),
      raw: z.string(),
      fallback: z.string().nullable(),
    }),
  ),
  heuristic: candidateSchema.nullable(),
});
export type FormatterPreview = z.infer<typeof previewSchema>;

const suggestSchema = z.object({
  candidate: candidateSchema.extend({ code: z.string(), token: z.string() }).nullable(),
  reason: z.string().nullable(),
});
export type FormatterSuggestion = z.infer<typeof suggestSchema>;

/** `POST /v1/games/:id/formatter/preview` — the heuristic over the paste + last 2 shares. */
export async function previewFormatter(
  gameId: string,
  scoreRaw: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<FormatterPreview | null> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/games/${gameId}/formatter/preview`,
    body: { scoreRaw },
    token,
    ...(signal ? { signal } : {}),
  });
  const parsed = previewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `POST /v1/games/:id/formatter/suggest` — the model's formatter (one LLM call). */
export async function suggestFormatter(
  gameId: string,
  scoreRaw: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<FormatterSuggestion | null> {
  const raw = await apiRequest<unknown>({
    method: "POST",
    path: `/v1/games/${gameId}/formatter/suggest`,
    body: { scoreRaw },
    token,
    ...(signal ? { signal } : {}),
  });
  const parsed = suggestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type FormatterChoice =
  | { choice: "heuristic"; exampleRaw: string }
  | { choice: "llm"; exampleRaw: string; code: string; token: string };

/** `PUT /v1/games/:id/formatter` — "Looks good". */
export function setFormatter(gameId: string, body: FormatterChoice, token: string | null) {
  return apiRequest<{ game: Game }>({
    method: "PUT",
    path: `/v1/games/${gameId}/formatter`,
    body,
    token,
  });
}

/** `POST /v1/games/:id/formatter/reject` — "Show raw". */
export function rejectFormatter(
  gameId: string,
  body: { scoreRaw: string; shown: ("heuristic" | "llm")[] },
  token: string | null,
) {
  return apiRequest<{ ok: true }>({
    method: "POST",
    path: `/v1/games/${gameId}/formatter/reject`,
    body,
    token,
  });
}
