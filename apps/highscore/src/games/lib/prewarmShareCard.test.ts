import { afterEach, describe, expect, it, vi } from "vitest";
import { prewarmGameShareCard, shareCardUrl } from "./prewarmShareCard";

describe("shareCardUrl", () => {
  it("maps a play link to its OG card on the same origin", () => {
    expect(shareCardUrl("https://highscore.live/g/fzruFcqR")).toBe(
      "https://highscore.live/og/g/fzruFcqR.png",
    );
    expect(shareCardUrl("http://localhost:8082/g/abc123")).toBe(
      "http://localhost:8082/og/g/abc123.png",
    );
  });

  it("returns null for anything that is not a play link", () => {
    expect(shareCardUrl("not a url")).toBeNull();
    expect(shareCardUrl("https://highscore.live/friends/accept/x")).toBeNull();
    expect(shareCardUrl("https://highscore.live/g/")).toBeNull();
  });
});

describe("prewarmGameShareCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires one fetch for the card", () => {
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    prewarmGameShareCard("https://highscore.live/g/fzruFcqR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://highscore.live/og/g/fzruFcqR.png");
  });

  it("never throws — bad URLs and failed fetches are swallowed", async () => {
    const fetchMock = vi.fn((_url: string) => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);
    expect(() => prewarmGameShareCard("not a url")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => prewarmGameShareCard("https://highscore.live/g/x")).not.toThrow();
    await Promise.resolve();
  });
});
