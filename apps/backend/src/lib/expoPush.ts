// Expo push delivery, shared by the play-reminder job (`jobs/playReminders.ts`),
// the operator push panel (`POST /v1/admin/push/send`), the inbound
// friend-request push (`lib/friendRequestPush.ts`) and nudges
// (`lib/nudges.ts`). One place that
// chunks messages to Expo's 100-per-request limit, validates the ticket
// response with zod, and prunes `DeviceNotRegistered` tokens from
// `push_tokens`. The endpoint comes from `EXPO_PUSH_URL` (config), so a
// sandbox can point it at a local stub — never send to Expo with production
// tokens from anywhere but the deployed backend.

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { pushTokens } from "../db/schema.js";
import { getConfig } from "./config.js";
import { localPushEndpoint, postLocalPush } from "./localPush.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

const EXPO_CHUNK_SIZE = 100;

const expoTicketResponseSchema = z.object({
  data: z.array(
    z.object({
      status: z.enum(["ok", "error"]),
      details: z
        .object({
          error: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
}

/**
 * Per-message outcome, aligned with the input array:
 * - `ok`: Expo accepted it (a ticket, not a delivery receipt).
 * - `error`: Expo answered for this message with an error ticket.
 * - `request_failed`: the whole chunk failed (HTTP error, bad payload) —
 *   Expo never answered for this message.
 */
interface ExpoPushOutcome {
  to: string;
  status: "ok" | "error" | "request_failed";
  error?: string;
}

export interface ExpoPushSendResult {
  /** `ok` tickets. */
  sent: number;
  /** Error tickets plus messages in failed chunks. */
  failed: number;
  /** Tokens deleted from `push_tokens` after a `DeviceNotRegistered` ticket. */
  prunedTokens: string[];
  outcomes: ExpoPushOutcome[];
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

/**
 * Send `messages` to Expo in chunks of 100. A chunk that fails is logged
 * (`onChunkError`, default `expo push chunk failed`) and isolated — later
 * chunks still go. Every `DeviceNotRegistered` token is deleted after the
 * loop. Never throws for a delivery problem; only a prune DB error escapes.
 */
export async function sendExpoPushMessages(
  messages: (ExpoPushMessage & { recipientId: string })[],
  opts: {
    category: "play_reminder" | "friend_request" | "poke" | "admin_message";
    db?: DbClient | undefined;
    fetchFn?: typeof fetch | undefined;
    timeoutMs?: number;
    onChunkError?: (error: unknown, chunkIndex: number, chunkSize: number) => void;
  },
): Promise<ExpoPushSendResult> {
  const { isLocal, expoPushUrl } = getConfig();
  const outcomes: ExpoPushOutcome[] = [];
  const tokensToPrune = new Set<string>();

  for (const [chunkIndex, chunk] of chunksOf(messages, EXPO_CHUNK_SIZE).entries()) {
    const offset = outcomes.length;
    try {
      const url = isLocal ? localPushEndpoint(expoPushUrl) : expoPushUrl;
      const timeoutMs = opts.timeoutMs ?? (isLocal ? 3000 : undefined);
      const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
      const body = JSON.stringify(
        isLocal
          ? chunk.map(({ recipientId, title, body }) => ({
              category: opts.category,
              recipientId,
              title,
              body,
            }))
          : chunk.map(({ recipientId: _, ...message }) => message),
      );
      let payload: unknown;
      if (url instanceof URL && !opts.fetchFn) {
        payload = await postLocalPush(url, body, signal ?? AbortSignal.timeout(3000));
      } else {
        const response = await (opts.fetchFn ?? fetch)(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          ...(signal && { signal }),
          ...(isLocal && { redirect: "error" }),
        });
        if (!response.ok) {
          throw new Error(`Expo push request failed with status ${response.status}`);
        }
        payload = await response.json();
      }
      const parsed = expoTicketResponseSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Expo push response had an invalid ticket payload");
      if (parsed.data.data.length !== chunk.length) {
        throw new Error("Expo push response ticket count did not match the request");
      }
      for (const [index, ticket] of parsed.data.data.entries()) {
        const message = chunk[index];
        if (!message) continue;
        if (ticket.status === "ok") {
          outcomes.push({ to: message.to, status: "ok" });
          continue;
        }
        const error = ticket.details?.error;
        outcomes.push({ to: message.to, status: "error", ...(error ? { error } : {}) });
        if (!isLocal && error === "DeviceNotRegistered") tokensToPrune.add(message.to);
      }
    } catch (error) {
      if (opts.onChunkError) opts.onChunkError(error, chunkIndex, chunk.length);
      else {
        logger.error("expo push chunk failed", {
          error,
          chunk_index: chunkIndex,
          token_count: chunk.length,
        });
      }
      for (const message of chunk) outcomes.push({ to: message.to, status: "request_failed" });
    }
    for (const [index, message] of chunk.entries()) {
      const outcome = outcomes[offset + index];
      logger.info("highscore_push_outcome", {
        category: opts.category,
        recipient_id: message.recipientId,
        ...(!isLocal && { title: message.title, body: message.body }),
        status: outcome?.status,
        ...(!isLocal && { expo_error: outcome?.error }),
      });
    }
  }

  let prunedTokens: string[] = [];
  if (tokensToPrune.size > 0) {
    const db = opts.db ?? getDb();
    const deleted = await db
      .delete(pushTokens)
      .where(inArray(pushTokens.expoPushToken, [...tokensToPrune]))
      .returning({ expoPushToken: pushTokens.expoPushToken });
    prunedTokens = deleted.map((row) => row.expoPushToken);
  }

  const sent = outcomes.filter((o) => o.status === "ok").length;
  return { sent, failed: outcomes.length - sent, prunedTokens, outcomes };
}
