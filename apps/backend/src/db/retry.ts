import { logger } from "../lib/logger.js";

/**
 * postgres-js / node socket error codes that mean the connection never
 * finished opening — so no statement was ever sent to Postgres. Safe to retry
 * even for writes: a failed *connect* can't have partially applied anything.
 *
 * The headline case is Neon's serverless compute scaling to zero after idle
 * (~5min default). The first request back races Neon's wake-up; if it loses,
 * postgres-js rejects with `CONNECT_TIMEOUT`. A second attempt a beat later —
 * once Neon has had a moment to resume — usually connects fine.
 */
const TRANSIENT_CONNECT_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

/**
 * True when `error` (or anything in its `cause` chain — drizzle wraps the
 * postgres-js error, which may itself wrap a socket error) is a transient
 * connection-establishment failure worth retrying.
 */
export function isTransientDbConnectError(error: unknown): boolean {
  let cur: unknown = error;
  for (let i = 0; i < 6 && cur != null; i++) {
    const code = (cur as { code?: unknown }).code ?? (cur as { errno?: unknown }).errno;
    if (typeof code === "string" && TRANSIENT_CONNECT_CODES.has(code)) {
      return true;
    }
    const next = (cur as { cause?: unknown }).cause;
    if (next === cur) break;
    cur = next;
  }
  return false;
}

interface DbRetryOptions {
  /** Total tries (initial + retries). Default 3. */
  maxAttempts?: number;
  /** Base backoff before jitter, doubled each retry. Default 250ms. */
  baseDelayMs?: number;
  /** Backoff ceiling before jitter. Default 1500ms. */
  maxDelayMs?: number;
  /**
   * Hard wall-clock cap on the whole retry sequence, including waits AND the
   * worst-case cost of the next attempt (`attemptCostMs`). Keep this comfortably
   * under the Lambda function timeout (currently 15s) so a retry storm can never
   * get the function killed mid-flight. Default 12000ms.
   */
  budgetMs?: number;
  /**
   * Assumed worst-case duration of a single attempt — should track the
   * postgres-js `connect_timeout` in `client.ts` (currently 5s). Used for the
   * budget look-ahead so we never *start* an attempt that could overrun.
   * Default 5000ms.
   */
  attemptCostMs?: number;
  /** Tag for retry logs. */
  label?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a DB operation, retrying transient connection failures with exponential
 * backoff + full jitter. Non-connection errors (constraint violations, query
 * errors, etc.) are re-thrown immediately — we only paper over Neon cold-starts,
 * never real failures. Transparent on success, so it's a no-op overhead on the
 * warm path and safe to wrap any read or (idempotent-on-connect-failure) write.
 *
 * `fn` is re-invoked from scratch on each attempt, so pass a thunk that builds
 * the query fresh — e.g. `withDbRetry(() => db.select()....limit(1))`.
 */
export async function withDbRetry<T>(
  fn: () => PromiseLike<T>,
  options: DbRetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 1500,
    budgetMs = 12_000,
    attemptCostMs = 5_000,
    label = "db",
  } = options;

  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientDbConnectError(error)) {
        throw error;
      }
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.round(Math.random() * ceiling);
      const elapsed = Date.now() - start;
      // Don't start another attempt that could blow the Lambda timeout.
      if (elapsed + delay + attemptCostMs > budgetMs) {
        throw error;
      }
      logger.warn("db connection retry", {
        label,
        attempt,
        max_attempts: maxAttempts,
        delay_ms: delay,
        elapsed_ms: elapsed,
        root_error: (error as { code?: unknown })?.code,
      });
      await sleep(delay);
    }
  }
}
