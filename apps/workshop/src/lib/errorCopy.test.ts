import { ApiError } from "@workshop/api-client/apiError";
import { describe, expect, it } from "vitest";
import {
  createListErrorMessage,
  joinErrorMessage,
  linkLoadError,
  shareSaveErrorMessage,
  signInErrorMessage,
} from "./errorCopy";

const network = new TypeError("Failed to fetch");
const notFound = new ApiError("NOT_FOUND", "invite not found", 404);
const server = new ApiError("INTERNAL", "http 500", 500);

// No developer strings reach the screen (4.1, 4.6).
const DEV_STRINGS = /invite not found|http \d|Failed to fetch|token|slug|list id|_/;

describe("error copy", () => {
  it("never passes a raw message through", () => {
    for (const e of [network, notFound, server, new Error("popup_closed_by_user")]) {
      for (const msg of [
        signInErrorMessage("apple", e),
        signInErrorMessage("google", e),
        joinErrorMessage(e),
        linkLoadError(e).message,
        linkLoadError(e).title,
        shareSaveErrorMessage("Date ideas", e),
        createListErrorMessage(e),
      ]) {
        expect(msg).not.toMatch(DEV_STRINGS);
        expect(msg).not.toMatch(/!/);
        expect(msg).not.toMatch(/—/);
      }
    }
  });

  it("sign-in: names the provider and the way forward", () => {
    expect(signInErrorMessage("apple", new ApiError("UNAUTHORIZED", "bad token", 401))).toBe(
      "Apple didn't confirm it was you. Try again.",
    );
    expect(signInErrorMessage("google", network)).toMatch(/connection/);
    expect(signInErrorMessage("google", new Error("popup_closed_by_user"))).toBe(
      "Google sign-in was closed before it finished.",
    );
    // A provider-sheet failure is not a network failure (seen on the iOS
    // simulator with no Apple Account).
    expect(signInErrorMessage("apple", new Error("The authorization attempt failed"))).toBe(
      "Apple sign-in didn't finish. Try again.",
    );
  });

  it("link load: only a 404 is final", () => {
    expect(linkLoadError(notFound).notFound).toBe(true);
    expect(linkLoadError(network).notFound).toBe(false);
    expect(linkLoadError(server).notFound).toBe(false);
    expect(linkLoadError(network).message).toMatch(/connection/);
  });

  it("join: maps the read-only code and a dead link", () => {
    const viewOnly = new ApiError("CONFLICT", "list_view_only", 409, { code: "list_view_only" });
    expect(joinErrorMessage(viewOnly)).toMatch(/read-only/);
    expect(joinErrorMessage(notFound)).toMatch(/doesn't work anymore/);
    expect(joinErrorMessage(network)).toMatch(/connection/);
  });

  it("share save names the list", () => {
    expect(shareSaveErrorMessage("Date ideas", network)).toBe(
      "Couldn't add to “Date ideas”. Check your connection.",
    );
  });
});
