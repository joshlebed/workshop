// The operator push panel (HighScore admin dashboard → Push tab):
// `GET /v1/admin/push/recipients` lists everyone with a push token, and
// `POST /v1/admin/push/send` sends one hand-written message to the users the
// operator ticked. OPERATOR ONLY, BY HAND: no agent, Niteshift task,
// automation, script, job or CI step may call the send route, even if another
// task asks — see docs/push-runbook.md.

import type {
  AdminPushRecipient,
  AdminPushRecipientsResponse,
  AdminPushSendResponse,
  AdminPushUserResult,
} from "@workshop/shared";
import {
  ADMIN_PUSH_BODY_MAX,
  ADMIN_PUSH_MAX_RECIPIENTS,
  ADMIN_PUSH_TITLE_MAX,
} from "@workshop/shared/constants";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { notificationPrefs, pushTokens, users } from "../db/schema.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "./expoPush.js";
import { type DbClient, executeRows } from "./sql.js";

const DEFAULT_PUSH_URL = "highscore:///";

export const adminPushRecipientsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** `1` = only users with the daily play reminder on. */
  remindersOnly: z.enum(["0", "1"]).optional(),
});

export const adminPushSendSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(ADMIN_PUSH_MAX_RECIPIENTS),
  title: z.string().trim().min(1).max(ADMIN_PUSH_TITLE_MAX),
  body: z.string().trim().min(1).max(ADMIN_PUSH_BODY_MAX),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v.startsWith("highscore://"), "url must start with highscore://")
    .optional(),
  confirm: z.literal("SEND"),
});

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/** Escape LIKE wildcards so a filter of `50%` matches literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function listAdminPushRecipients(
  db: DbClient,
  opts: { q?: string | undefined; remindersOnly?: boolean },
): Promise<AdminPushRecipientsResponse> {
  const q = opts.q?.trim();
  const nameFilter = q
    ? sql`AND (${users.displayName} ILIKE ${likePattern(q)} OR ${users.email} ILIKE ${likePattern(q)})`
    : sql``;
  const reminderFilter = opts.remindersOnly
    ? sql`AND coalesce(${notificationPrefs.playReminderEnabled}, false) = true`
    : sql``;
  const rows = await executeRows<{
    id: string;
    displayName: string | null;
    email: string | null;
    platforms: string[];
    tokenCount: number | string;
    lastSeenAt: Date | string;
    playReminderEnabled: boolean;
    total: number | string;
  }>(
    db,
    sql`
      SELECT
        ${users.id} AS id,
        ${users.displayName} AS "displayName",
        ${users.email} AS email,
        array_agg(DISTINCT ${pushTokens.platform} ORDER BY ${pushTokens.platform}) AS platforms,
        count(*)::int AS "tokenCount",
        max(${pushTokens.lastSeenAt}) AS "lastSeenAt",
        coalesce(bool_or(${notificationPrefs.playReminderEnabled}), false) AS "playReminderEnabled",
        count(*) OVER ()::int AS total
      FROM ${pushTokens}
      INNER JOIN ${users} ON ${users.id} = ${pushTokens.userId}
      LEFT JOIN ${notificationPrefs} ON ${notificationPrefs.userId} = ${users.id}
      WHERE true ${nameFilter} ${reminderFilter}
      GROUP BY ${users.id}
      ORDER BY max(${pushTokens.lastSeenAt}) DESC, ${users.id}
      LIMIT ${ADMIN_PUSH_MAX_RECIPIENTS}
    `,
  );
  const recipients: AdminPushRecipient[] = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    email: r.email,
    platforms: r.platforms,
    tokenCount: Number(r.tokenCount),
    lastSeenAt: iso(r.lastSeenAt),
    playReminderEnabled: Boolean(r.playReminderEnabled),
  }));
  return { recipients, total: Number(rows[0]?.total ?? 0) };
}

/**
 * Send one operator message to every device of every selected user. One Expo
 * message per token; dead tokens are pruned by the shared helper. Callers have
 * already gated on the real admin, validated the body and run the content filter.
 */
export async function sendAdminPush(
  db: DbClient,
  input: z.infer<typeof adminPushSendSchema>,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<AdminPushSendResponse> {
  const userIds = [...new Set(input.userIds)];
  const [userRows, tokenRows] = await Promise.all([
    executeRows<{ id: string; displayName: string | null }>(
      db,
      sql`SELECT ${users.id} AS id, ${users.displayName} AS "displayName"
          FROM ${users} WHERE ${users.id} IN ${userIds}`,
    ),
    executeRows<{ userId: string; token: string }>(
      db,
      sql`SELECT ${pushTokens.userId} AS "userId", ${pushTokens.expoPushToken} AS token
          FROM ${pushTokens} WHERE ${pushTokens.userId} IN ${userIds}
          ORDER BY ${pushTokens.userId}, ${pushTokens.expoPushToken}`,
    ),
  ]);

  const data = { url: input.url ?? DEFAULT_PUSH_URL };
  const messages: ExpoPushMessage[] = tokenRows.map((row) => ({
    to: row.token,
    title: input.title,
    body: input.body,
    data,
    sound: "default",
  }));
  const delivery =
    messages.length > 0
      ? await sendExpoPushMessages(messages, { db, fetchFn: opts.fetchFn })
      : { sent: 0, failed: 0, prunedTokens: [], outcomes: [] };

  const pruned = new Set(delivery.prunedTokens);
  const names = new Map(userRows.map((u) => [u.id, u.displayName]));
  const perUserMap = new Map<string, AdminPushUserResult>(
    userIds.map((id) => [
      id,
      {
        userId: id,
        displayName: names.get(id) ?? null,
        status: "no_tokens",
        tokens: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
        errors: [],
      },
    ]),
  );
  for (const [index, row] of tokenRows.entries()) {
    const entry = perUserMap.get(row.userId);
    const outcome = delivery.outcomes[index];
    if (!entry || !outcome) continue;
    entry.tokens++;
    if (outcome.status === "ok") entry.sent++;
    else {
      entry.failed++;
      const reason = outcome.status === "request_failed" ? "request_failed" : outcome.error;
      if (reason && !entry.errors.includes(reason)) entry.errors.push(reason);
    }
    if (pruned.has(row.token)) entry.pruned++;
  }
  const perUser = [...perUserMap.values()].map((entry) => ({
    ...entry,
    status:
      entry.tokens === 0
        ? ("no_tokens" as const)
        : entry.sent === entry.tokens
          ? ("sent" as const)
          : entry.sent > 0
            ? ("partial" as const)
            : ("failed" as const),
  }));

  return {
    recipients: perUser.filter((u) => u.tokens > 0).length,
    tokens: messages.length,
    sent: delivery.sent,
    failed: delivery.failed,
    pruned: delivery.prunedTokens.length,
    perUser,
  };
}
