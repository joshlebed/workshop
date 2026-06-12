import type { Context } from "hono";
import { logger } from "./logger.js";

const MAX_VERSION = 32;

type LegacyGameListConfig = {
  itemKind: string | null | undefined;
  modules: readonly string[] | null | undefined;
};

type LogContext = Context & {
  get(key: "userId"): string | undefined;
  get(key: "requestId"): string | undefined;
};

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function detectPlatform(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("workshop")) return "ios";
  if (ua.includes("okhttp")) return "android";
  if (ua.includes("expo")) return "expo";
  if (ua.includes("facebookexternalhit") || ua.includes("twitterbot") || ua.includes("slackbot")) {
    return "bot";
  }
  if (ua.includes("mozilla")) return "web";
  return "other";
}

function requestFields(c: Context, userId?: string | null): Record<string, unknown> {
  const ctx = c as LogContext;
  return {
    request_id: ctx.get("requestId") ?? null,
    method: c.req.method,
    path: c.req.path,
    route: c.req.routePath,
    user_id: userId !== undefined ? userId : (ctx.get("userId") ?? null),
    platform: c.req.header("x-workshop-platform") ?? detectPlatform(c.req.header("user-agent")),
    app_version: truncate(c.req.header("x-workshop-app-version"), MAX_VERSION) ?? null,
  };
}

export function isLegacyGameListConfig(list: LegacyGameListConfig): boolean {
  return list.itemKind === "game" || (list.modules ?? []).includes("leaderboard");
}

export function logLegacyGameListAccess(
  c: Context,
  details: {
    operation: string;
    listId: string;
    itemId?: string | null;
    periodKey?: string | null;
    status?: number;
    scoreBackend?: "game_scores" | "item_scores" | null;
    userId?: string | null;
  },
): void {
  logger.info("legacy_game_list_access", {
    kind: "legacy_game_list_access",
    event: "legacy_game_list_access",
    ...requestFields(c, details.userId),
    operation: details.operation,
    status: details.status ?? 200,
    list_id: details.listId,
    item_id: details.itemId ?? null,
    period_key: details.periodKey ?? null,
    score_backend: details.scoreBackend ?? null,
  });
}

export function logLegacyGameListRetiredRejected(
  c: Context,
  details: {
    operation: string;
    listId?: string | null;
    existing?: LegacyGameListConfig | null;
    proposed: LegacyGameListConfig;
    userId?: string | null;
  },
): void {
  logger.info("legacy_game_list_retired_rejected", {
    kind: "legacy_game_list_retired_rejected",
    event: "legacy_game_list_retired_rejected",
    ...requestFields(c, details.userId),
    operation: details.operation,
    status: 400,
    list_id: details.listId ?? null,
    existing_item_kind: details.existing?.itemKind ?? null,
    existing_modules: details.existing?.modules ?? null,
    proposed_item_kind: details.proposed.itemKind ?? null,
    proposed_modules: details.proposed.modules ?? null,
  });
}
