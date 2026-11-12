import { describe, expect, it, vi } from "vitest";
import { createConfirmStore } from "./confirmStore";

describe("confirm store", () => {
  it("resolves the request with the host's answer", async () => {
    const store = createConfirmStore();
    store.registerHost();
    const yes = store.request({ title: "Delete list?" });
    store.settle(store.current()!.id, true);
    await expect(yes).resolves.toBe(true);

    const no = store.request({ title: "Leave list?" });
    store.settle(store.current()!.id, false);
    await expect(no).resolves.toBe(false);
  });

  it("shows one request at a time, in order", async () => {
    const store = createConfirmStore();
    store.registerHost();
    const seen: (string | null)[] = [];
    store.subscribe((c) => seen.push(c?.title ?? null));
    const a = store.request({ title: "A" });
    const b = store.request({ title: "B" });
    expect(store.current()?.title).toBe("A");
    store.settle(store.current()!.id, true);
    expect(store.current()?.title).toBe("B");
    store.settle(store.current()!.id, false);
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(false);
    expect(seen).toEqual(["A", "B", null]);
  });

  it("ignores a stale settle for a request that is not showing", async () => {
    const store = createConfirmStore();
    store.registerHost();
    const first = store.request({ title: "A" });
    const id = store.current()!.id;
    store.settle(id + 99, true);
    expect(store.current()?.id).toBe(id);
    store.settle(id, true);
    store.settle(id, false);
    await expect(first).resolves.toBe(true);
  });

  it("tracks whether a host is mounted and cancels pending requests when it goes", async () => {
    const store = createConfirmStore();
    expect(store.hasHost()).toBe(false);
    const unregister = store.registerHost();
    expect(store.hasHost()).toBe(true);
    const pending = store.request({ title: "A" });
    const listener = vi.fn();
    store.subscribe(listener);
    unregister();
    expect(store.hasHost()).toBe(false);
    await expect(pending).resolves.toBe(false);
    expect(listener).toHaveBeenLastCalledWith(null);
  });
});
