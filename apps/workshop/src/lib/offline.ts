import { ApiError } from "./api";

export function isOfflineError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ApiError) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("network request failed") ||
      msg.includes("networkerror")
    );
  }
  return false;
}
