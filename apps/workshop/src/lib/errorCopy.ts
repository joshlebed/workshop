/**
 * Plain sentences for the errors a person meets at the edges of the app
 * (UX pass 4.1, 4.6): signing in, opening a share link, joining a list.
 * Never a raw `e.message`, a server code or a developer string; each message
 * says what happened and, where there is one, the way forward.
 *
 * Pure (imports the error class from `apiError`, not `api`), so vitest can
 * load it without the app bundle.
 */
import { ApiError, apiErrorCode } from "@workshop/api-client/apiError";

export type SignInProvider = "apple" | "google" | "dev";

const PROVIDER_NAME: Record<SignInProvider, string> = {
  apple: "Apple",
  google: "Google",
  dev: "Dev sign-in",
};

/** A failed request that never reached the server (fetch threw). */
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof ApiError);
}

/** True only for an answer that settles it: the thing does not exist. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function signInErrorMessage(provider: SignInProvider, error: unknown): string {
  const name = PROVIDER_NAME[provider];
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 400) {
      return `${name} didn't confirm it was you. Try again.`;
    }
    if (error.status === 429) return "Too many tries in a row. Wait a minute, then try again.";
    return "Workshop couldn't finish signing you in. Try again in a moment.";
  }
  // `fetch` rejects with a TypeError when the request never got out.
  if (error instanceof TypeError) {
    return "Couldn't reach Workshop. Check your connection and try again.";
  }
  if (error instanceof Error && /popup|closed|cancel/i.test(error.message)) {
    return `${name} sign-in was closed before it finished.`;
  }
  // Anything else came from the provider's own sheet (e.g. no Apple Account
  // on the device, or the sheet dismissed with an error code).
  return `${name} sign-in didn't finish. Try again.`;
}

/** A share link's list couldn't be shown. `notFound` decides the stash's fate. */
export function linkLoadError(error: unknown): {
  title: string;
  message: string;
  notFound: boolean;
} {
  if (isNotFound(error)) {
    return {
      title: "This link doesn't open a list anymore",
      message: "The owner may have turned sharing off or reset the link. Ask them for a new one.",
      notFound: true,
    };
  }
  if (isNetworkError(error)) {
    return {
      title: "Couldn't open this list",
      message: "Check your connection and try again.",
      notFound: false,
    };
  }
  return {
    title: "Couldn't open this list",
    message: "Something went wrong on our side. Try again in a moment.",
    notFound: false,
  };
}

/** A join (by share link or legacy invite) failed. */
export function joinErrorMessage(error: unknown): string {
  if (apiErrorCode(error) === "list_view_only") {
    return "This list is read-only now. Ask the owner to turn on joining.";
  }
  if (isNotFound(error)) return "This link doesn't work anymore. Ask for a new one.";
  if (isNetworkError(error)) return "Couldn't join. Check your connection and try again.";
  return "Couldn't join this list. Try again in a moment.";
}

/** Saving a shared link or text into a list failed. */
export function shareSaveErrorMessage(listName: string, error: unknown): string {
  if (isNotFound(error)) return `“${listName}” isn't available anymore. Pick another list.`;
  if (isNetworkError(error)) return `Couldn't add to “${listName}”. Check your connection.`;
  return `Couldn't add to “${listName}”.`;
}

/**
 * The line under "Couldn't load this list / item": the way forward, never the
 * raw `e.message` ("Failed to fetch", a server string).
 */
export function loadErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return "Check your connection and try again.";
  return "Something went wrong on our side. Try again in a moment.";
}

/** Creating a list failed. */
export function createListErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return "Couldn't make the list. Check your connection and try again.";
  return "Couldn't make the list. Try again in a moment.";
}

/** Toasts for failed writes share this key, so a burst of failures shows one. */
export const FAILURE_TOAST_KEY = "failure";

/**
 * The message for a failed write's toast (UX pass 5, critique): `fallback`
 * says what didn't happen ("Couldn't move that item."). A server message is
 * used only when it is already a plain sentence written for people; raw
 * fetch errors ("Failed to fetch"), codes and lowercase validator text never
 * reach the screen. A network failure is left to the offline toast, which
 * replaces this one (same key) and offers Retry.
 */
export function failureMessage(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return `${fallback} Check your connection.`;
  const message = error instanceof ApiError ? error.message.trim() : "";
  const status = error instanceof ApiError ? error.status : 500;
  if (status < 500 && /^[A-Z][^_{}<>]*[.?]$/.test(message) && message.length <= 140) {
    return message;
  }
  return status >= 500 ? `${fallback} Try again in a moment.` : fallback;
}
