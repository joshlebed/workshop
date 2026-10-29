// Materializes hourly request-traffic rollups from the CloudWatch request log
// into `request_rollups`, for the admin analytics dashboards. Invoked by the
// EventBridge Scheduler with `{ "job": "request-rollups" }` once an hour.
//
// Each run re-computes the last LOOKBACK_HOURS complete hours (delete +
// insert in one transaction), so a missed or slow run self-heals on the next
// tick and the job is safe to invoke by hand. Logs Insights is the source of
// truth; nothing here runs on a user request's path.

import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { and, gte, lt } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { requestRollups } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import type { DbClient } from "../lib/sql.js";

const LOG_GROUP = process.env.REQUEST_LOG_GROUP ?? "/aws/lambda/workshop-prod-api";
const LOOKBACK_HOURS = 3;
const HOUR_MS = 3_600_000;
const POLL_MS = 400;
const QUERY_TIMEOUT_MS = 11_000;

/** The Logs Insights query; every dimension is coalesced so the PK is never NULL. */
const ROLLUP_QUERY = `filter kind = "request"
| fields (status >= 500) as is_error, coalesce(client, "unknown") as client_app, coalesce(platform, "unknown") as plat, coalesce(app_version, "unknown") as ver, coalesce(route, path, "?") as rt, coalesce(method, "?") as meth
| stats count() as requests, count_distinct(user_id) as users, sum(is_error) as errors, avg(duration_ms) as avg_ms by bin(1h) as hour, client_app, plat, ver, meth, rt
| limit 10000`;

interface RollupRow {
  hour: Date;
  client: string;
  platform: string;
  appVersion: string;
  method: string;
  route: string;
  requests: number;
  users: number;
  errors: number;
  avgMs: number;
}

/** Runs the query for [start, end) and returns the raw result rows as field maps. */
type RollupQueryRunner = (args: { start: Date; end: Date }) => Promise<Record<string, string>[]>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Real runner: StartQuery + poll GetQueryResults until complete. */
const cloudWatchRollupQuery: RollupQueryRunner = async ({ start, end }) => {
  const client = new CloudWatchLogsClient({});
  const started = await client.send(
    new StartQueryCommand({
      logGroupName: LOG_GROUP,
      startTime: Math.floor(start.getTime() / 1000),
      endTime: Math.floor(end.getTime() / 1000),
      queryString: ROLLUP_QUERY,
    }),
  );
  const queryId = started.queryId;
  if (!queryId) throw new Error("StartQuery returned no queryId");
  const deadline = Date.now() + QUERY_TIMEOUT_MS;
  for (;;) {
    const res = await client.send(new GetQueryResultsCommand({ queryId }));
    if (res.status === "Complete") {
      return (res.results ?? []).map((fields) =>
        Object.fromEntries(fields.map((f) => [f.field ?? "", f.value ?? ""])),
      );
    }
    if (res.status === "Failed" || res.status === "Cancelled" || res.status === "Timeout") {
      throw new Error(`Logs Insights query ${res.status}`);
    }
    if (Date.now() > deadline) throw new Error("Logs Insights query timed out");
    await sleep(POLL_MS);
  }
};

/** Logs Insights renders `bin(1h)` as `YYYY-MM-DD HH:mm:ss.SSS` in UTC. */
export function parseInsightsTimestamp(value: string): Date | null {
  const d = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toRollupRows(results: Record<string, string>[]): RollupRow[] {
  const out: RollupRow[] = [];
  for (const r of results) {
    const hour = parseInsightsTimestamp(r.hour ?? "");
    if (!hour) continue;
    out.push({
      hour,
      client: r.client_app || "unknown",
      platform: (r.plat || "unknown").toLowerCase(),
      appVersion: r.ver || "unknown",
      method: r.meth || "?",
      route: r.rt || "?",
      requests: Math.round(Number(r.requests) || 0),
      users: Math.round(Number(r.users) || 0),
      errors: Math.round(Number(r.errors) || 0),
      avgMs: Math.round(Number(r.avg_ms) || 0),
    });
  }
  return out;
}

/** [start, end): the last `hours` complete UTC hours before `now`. */
export function rollupWindow(now: Date, hours = LOOKBACK_HOURS): { start: Date; end: Date } {
  const end = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return { start: new Date(end.getTime() - hours * HOUR_MS), end };
}

interface RequestRollupJobResult {
  windowStart: string;
  windowEnd: string;
  rows: number;
}

export async function runRequestRollupJob(
  args: { now?: Date; query?: RollupQueryRunner; db?: DbClient; hours?: number } = {},
): Promise<RequestRollupJobResult> {
  const now = args.now ?? new Date();
  const db = args.db ?? getDb();
  const runQuery = args.query ?? cloudWatchRollupQuery;
  const { start, end } = rollupWindow(now, args.hours);

  const rows = toRollupRows(await runQuery({ start, end })).filter(
    (r) => r.hour >= start && r.hour < end,
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(requestRollups)
      .where(and(gte(requestRollups.hour, start), lt(requestRollups.hour, end)));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      if (chunk.length > 0) await tx.insert(requestRollups).values(chunk);
    }
  });

  const result = {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    rows: rows.length,
  };
  logger.info("request rollups written", result);
  return result;
}
