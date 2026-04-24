import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL: 500,
};

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json(data, status);
}

export function err(
  c: Context,
  code: ErrorCode,
  message: string,
  details?: unknown,
  status?: ContentfulStatusCode,
) {
  const body: { error: string; code: ErrorCode; details?: unknown } = { error: message, code };
  if (details !== undefined) body.details = details;
  return c.json(body, status ?? STATUS[code]);
}
