import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAppOpen, watchAppOpen } from "./appHandoff";

describe("browser app handoff", () => {
  let page: EventTarget & { location: { assign: ReturnType<typeof vi.fn> } };
  let document: EventTarget & { visibilityState: string };

  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { location: { assign: vi.fn() } });
    document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", document);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the exact route once and doesn't retry when the page returns", () => {
    scheduleAppOpen("highscore:///g/test-token");
    vi.runAllTimers();
    page.dispatchEvent(new Event("pageshow"));
    vi.runAllTimers();
    expect(page.location.assign).toHaveBeenCalledExactlyOnceWith("highscore:///g/test-token");
  });

  it("cancels an unmounted attempt, including React effect replay", () => {
    const cancel = scheduleAppOpen("highscore:///g/old");
    cancel();
    scheduleAppOpen("highscore:///friends/accept/new");
    vi.runAllTimers();
    expect(page.location.assign).toHaveBeenCalledExactlyOnceWith("highscore:///friends/accept/new");
  });

  it("doesn't open from a hidden page", () => {
    scheduleAppOpen("highscore:///g/test-token");
    document.visibilityState = "hidden";
    vi.runAllTimers();
    expect(page.location.assign).not.toHaveBeenCalled();
  });

  it("leaves the page usable when the browser rejects scripted navigation", () => {
    page.location.assign.mockImplementation(() => {
      throw new Error("User gesture required");
    });
    scheduleAppOpen("highscore:///g/test-token");
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it("continues on web when a manual tap leaves the page foregrounded", () => {
    const fallback = vi.fn();
    watchAppOpen(fallback);
    vi.advanceTimersByTime(2000);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it.each(["blur", "pagehide", "visibilitychange"])(
    "cancels the web fallback on %s, even after a quick return",
    (event) => {
      const fallback = vi.fn();
      watchAppOpen(fallback);
      if (event === "visibilitychange") {
        document.visibilityState = "hidden";
        document.dispatchEvent(new Event(event));
        document.visibilityState = "visible";
      } else {
        page.dispatchEvent(new Event(event));
      }
      vi.advanceTimersByTime(3000);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it("cancels fallback on unmount or an explicit continue", () => {
    const fallback = vi.fn();
    watchAppOpen(fallback)();
    vi.runAllTimers();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("ignores a late timer after suspension without lifecycle events", () => {
    const fallback = vi.fn();
    watchAppOpen(fallback);
    vi.setSystemTime(Date.now() + 60000);
    vi.runAllTimers();
    expect(fallback).not.toHaveBeenCalled();
  });
});
