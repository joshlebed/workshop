// `{ "job": "neon-quota" }`: warn before Neon's free-plan limits suspend the
// database (5 GB network transfer, 100 compute-hours a month). It reached
// 4.25 GB by day 18 once, with nothing watching.
//
// Usage comes from Neon's control-plane API, which does not wake the compute, so
// a quiet day never touches the database. `ops_alert_marks` is read only when
// something crosses a threshold. A mark is written after Discord accepts the
// message, so a dropped alert is sent again the next day.
//
// The API key is the SSM parameter named by NEON_API_KEY_PARAM. Until the
// operator creates it, the job logs one line and does nothing.

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { opsAlertMarks } from "../db/schema.js";
import { notifyDiscord } from "../lib/discord.js";
import { readSsmParameter } from "../lib/discordBot.js";
import { logger } from "../lib/logger.js";
import type { DbClient } from "../lib/sql.js";

const DEFAULT_API_URL = "https://console.neon.tech/api/v2";
const API_TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;

const TRANSFER_LIMIT_BYTES = 5_000_000_000;
const COMPUTE_LIMIT_SECONDS = 100 * 3600;

/** A projection is noise early in a month, or while usage is still small. */
const PACE_MIN_DAYS = 5;
const PACE_MIN_PCT = 30;

const LEVELS = ["pace", "70", "90"] as const;
type QuotaLevel = (typeof LEVELS)[number];
type QuotaMetric = "transfer" | "compute";

const projectSchema = z.object({
  project: z.object({
    data_transfer_bytes: z.number().nonnegative(),
    compute_time_seconds: z.number().nonnegative(),
    consumption_period_start: z.string(),
    consumption_period_end: z.string(),
  }),
});

export interface NeonUsage {
  transferBytes: number;
  computeSeconds: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface QuotaAlert {
  metric: QuotaMetric;
  level: QuotaLevel;
  used: number;
  limit: number;
  projected: number;
}

/** Neon's period, or the UTC calendar month when it reports an unusable one. */
export function usageFromProject(
  project: z.infer<typeof projectSchema>["project"],
  now: Date,
): NeonUsage {
  let periodStart = new Date(project.consumption_period_start);
  let periodEnd = new Date(project.consumption_period_end);
  const usable =
    !Number.isNaN(periodStart.getTime()) &&
    !Number.isNaN(periodEnd.getTime()) &&
    periodStart <= now &&
    periodEnd > now;
  if (!usable) {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  return {
    transferBytes: project.data_transfer_bytes,
    computeSeconds: project.compute_time_seconds,
    periodStart,
    periodEnd,
  };
}

/** The highest level each metric has reached, if any. Pure. */
export function evaluateQuota(usage: NeonUsage, now: Date): QuotaAlert[] {
  const elapsedMs = Math.max(1, now.getTime() - usage.periodStart.getTime());
  const periodMs = usage.periodEnd.getTime() - usage.periodStart.getTime();
  const metrics: { metric: QuotaMetric; used: number; limit: number }[] = [
    { metric: "transfer", used: usage.transferBytes, limit: TRANSFER_LIMIT_BYTES },
    { metric: "compute", used: usage.computeSeconds, limit: COMPUTE_LIMIT_SECONDS },
  ];
  const alerts: QuotaAlert[] = [];
  for (const { metric, used, limit } of metrics) {
    const pct = (used / limit) * 100;
    const projected = (used * periodMs) / elapsedMs;
    const onPaceToExceed =
      elapsedMs >= PACE_MIN_DAYS * DAY_MS && pct >= PACE_MIN_PCT && projected >= limit;
    const level: QuotaLevel | null =
      pct >= 90 ? "90" : pct >= 70 ? "70" : onPaceToExceed ? "pace" : null;
    if (level) alerts.push({ metric, level, used, limit, projected });
  }
  return alerts;
}

const markKey = (usage: NeonUsage, metric: QuotaMetric, level: QuotaLevel) =>
  `neon-quota:${usage.periodStart.toISOString().slice(0, 10)}:${metric}:${level}`;

/** This level and every higher one: reaching 90% silences a later 70% reading. */
const levelsAtOrAbove = (level: QuotaLevel) => LEVELS.slice(LEVELS.indexOf(level));

function formatAmount(alert: Pick<QuotaAlert, "metric">, value: number): string {
  return alert.metric === "transfer"
    ? `${(value / 1_000_000_000).toFixed(2)} GB`
    : `${(value / 3600).toFixed(1)} hours`;
}

/** Pure, so the wording is unit-tested. */
export function buildQuotaMessage(alerts: QuotaAlert[], usage: NeonUsage, now: Date): string {
  const day = Math.floor((now.getTime() - usage.periodStart.getTime()) / DAY_MS) + 1;
  const days = Math.round((usage.periodEnd.getTime() - usage.periodStart.getTime()) / DAY_MS);
  const resets = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(usage.periodEnd);
  const lines = alerts.map((alert) => {
    const name = alert.metric === "transfer" ? "Network transfer" : "Compute";
    const pct = Math.round((alert.used / alert.limit) * 100);
    const icon = alert.level === "90" ? "🔴" : "🟠";
    return `${icon} **${name}:** ${pct}% (${formatAmount(alert, alert.used)} of ${formatAmount(alert, alert.limit)}), on pace for ${formatAmount(alert, alert.projected)}`;
  });
  return [
    `⚠️ **Neon usage** · day ${day} of ${days}, resets ${resets}`,
    ...lines,
    "Neon suspends the database at the limit: docs/discord-bot-runbook.md",
  ].join("\n");
}

async function readMarks(db: DbClient, keys: string[]): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ key: opsAlertMarks.key })
      .from(opsAlertMarks)
      .where(inArray(opsAlertMarks.key, keys));
    return new Set(rows.map((r) => r.key));
  } catch (error) {
    // The database may be the thing that's over quota. Warn anyway.
    logger.warn("neon quota: marks unreadable, alerting without dedupe", { error });
    return new Set();
  }
}

async function readApiKeyFromSsm(): Promise<string | null> {
  const name = process.env.NEON_API_KEY_PARAM;
  if (!name) return null;
  try {
    return (await readSsmParameter(name))?.trim() || null;
  } catch (error) {
    if (error instanceof Error && error.name === "ParameterNotFound") return null;
    throw error;
  }
}

interface NeonQuotaDeps {
  now?: Date;
  db?: DbClient;
  fetcher?: typeof fetch;
  readApiKey?: () => Promise<string | null>;
  projectId?: string;
  apiUrl?: string;
  notify?: (content: string) => Promise<boolean>;
}

type NeonQuotaResult =
  | { status: "not_configured" }
  | { status: "ok"; alerts: 0 }
  | { status: "alerted" | "undelivered"; alerts: number };

export async function runNeonQuotaJob(deps: NeonQuotaDeps = {}): Promise<NeonQuotaResult> {
  const now = deps.now ?? new Date();
  const projectId = deps.projectId ?? process.env.NEON_PROJECT_ID;
  const apiKey = await (deps.readApiKey ?? readApiKeyFromSsm)();
  if (!apiKey || !projectId) {
    logger.info("neon quota skipped: not configured", {
      hasKey: Boolean(apiKey),
      hasProject: Boolean(projectId),
    });
    return { status: "not_configured" };
  }

  const base = deps.apiUrl ?? process.env.NEON_API_URL ?? DEFAULT_API_URL;
  const res = await (deps.fetcher ?? fetch)(`${base}/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Neon API answered ${res.status}`);
  const { project } = projectSchema.parse(await res.json());
  const usage = usageFromProject(project, now);
  const reached = evaluateQuota(usage, now);
  logger.info("neon quota checked", {
    transfer_bytes: usage.transferBytes,
    compute_seconds: usage.computeSeconds,
    period_start: usage.periodStart.toISOString(),
    reached: reached.map((a) => `${a.metric}:${a.level}`),
  });
  if (reached.length === 0) return { status: "ok", alerts: 0 };

  const db = deps.db ?? getDb();
  const candidateKeys = reached.flatMap((a) =>
    levelsAtOrAbove(a.level).map((level) => markKey(usage, a.metric, level)),
  );
  const marks = await readMarks(db, candidateKeys);
  const alerts = reached.filter(
    (a) => !levelsAtOrAbove(a.level).some((level) => marks.has(markKey(usage, a.metric, level))),
  );
  if (alerts.length === 0) return { status: "ok", alerts: 0 };

  const notify =
    deps.notify ??
    ((content: string) => notifyDiscord(content, { kind: "neon_quota", withClient: false }));
  const delivered = await notify(buildQuotaMessage(alerts, usage, now));
  if (!delivered) {
    logger.error("job failed", { job: "neon-quota", reason: "alert not delivered" });
    return { status: "undelivered", alerts: alerts.length };
  }
  try {
    await db
      .insert(opsAlertMarks)
      .values(alerts.map((a) => ({ key: markKey(usage, a.metric, a.level) })))
      .onConflictDoNothing();
  } catch (error) {
    logger.warn("neon quota: mark not saved, may repeat tomorrow", { error });
  }
  return { status: "alerted", alerts: alerts.length };
}
