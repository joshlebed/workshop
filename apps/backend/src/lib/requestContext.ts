// Per-request client identity, carried on AsyncLocalStorage so deep helpers
// (operator notifications in particular) can describe *who* did something —
// which app, which platform, which build — without every route threading the
// Hono context down through `notify*` wrappers.
//
// The three values come straight from the headers `@workshop/api-client`
// attaches to every request (`X-Workshop-Client`, `X-Workshop-Platform`,
// `X-Workshop-App-Version`). `requestLog` middleware enters the store for the
// lifetime of each request; outside a request (tests, scripts) the store is
// empty and `describeRequestClient()` returns null.

import { AsyncLocalStorage } from "node:async_hooks";
import { WORKSHOP_CLIENTS, type WorkshopClient } from "@workshop/shared/constants";

interface RequestClientContext {
  /** Validated `X-Workshop-Client`; null for pre-header clients, curl, bots. */
  client: WorkshopClient | null;
  /** Raw `X-Workshop-Platform` ("ios" | "web" | …); null when absent. */
  platform: string | null;
  /** Raw `X-Workshop-App-Version` (the app.json `version`); null when absent. */
  appVersion: string | null;
}

const MAX_HEADER = 32;
const storage = new AsyncLocalStorage<RequestClientContext>();

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_HEADER ? trimmed.slice(0, MAX_HEADER) : trimmed;
}

function parseClient(value: string | undefined): WorkshopClient | null {
  const trimmed = value?.trim();
  return (WORKSHOP_CLIENTS as readonly string[]).includes(trimmed ?? "")
    ? (trimmed as WorkshopClient)
    : null;
}

/** Build the context from a request's headers (case-insensitive getter). */
export function requestClientContextFromHeaders(
  header: (name: string) => string | undefined,
): RequestClientContext {
  return {
    client: parseClient(header("x-workshop-client")),
    platform: clean(header("x-workshop-platform")),
    appVersion: clean(header("x-workshop-app-version")),
  };
}

/** Run `fn` with `ctx` visible to `getRequestClientContext()` for its whole async lifetime. */
export function runWithRequestClientContext<T>(ctx: RequestClientContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestClientContext(): RequestClientContext | null {
  return storage.getStore() ?? null;
}

const CLIENT_LABELS: Record<WorkshopClient, string> = {
  workshop: "Workshop",
  highscore: "HighScore",
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  web: "web",
};

/**
 * Human suffix for an operator ping, e.g. `HighScore · iOS 1.4.0` or
 * `Workshop · web 0.9.2`. Returns null when the request carried none of the
 * three headers (server-to-server webhooks, scripts, bots) so the caller can
 * omit the suffix instead of printing "unknown · unknown".
 */
export function describeRequestClient(ctx = getRequestClientContext()): string | null {
  if (!ctx) return null;
  const { client, platform, appVersion } = ctx;
  if (!client && !platform && !appVersion) return null;
  const app = client ? CLIENT_LABELS[client] : "unknown app";
  const where = platform ? (PLATFORM_LABELS[platform] ?? platform) : null;
  const build = [where, appVersion].filter(Boolean).join(" ");
  return build ? `${app} · ${build}` : app;
}
