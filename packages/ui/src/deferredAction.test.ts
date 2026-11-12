import { describe, expect, it, vi } from "vitest";
import { createDeferredAction } from "./deferredAction";

describe("createDeferredAction", () => {
  it("does not run the action until flush (the sheet's onClosed)", () => {
    const d = createDeferredAction();
    const fn = vi.fn();
    d.defer(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(d.hasPending).toBe(true);
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs at most once", () => {
    const d = createDeferredAction();
    const fn = vi.fn();
    d.defer(fn);
    d.flush();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.hasPending).toBe(false);
  });

  it("a later choice replaces an earlier one", () => {
    const d = createDeferredAction();
    const first = vi.fn();
    const second = vi.fn();
    d.defer(first);
    d.defer(second);
    d.flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("closing without a choice runs nothing", () => {
    const d = createDeferredAction();
    const fn = vi.fn();
    d.defer(fn);
    d.cancel();
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
