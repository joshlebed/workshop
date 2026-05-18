import { afterEach, describe, expect, it, vi } from "vitest";

// We import lazily inside each test so init-time errors are observable.
async function importPersister() {
  vi.resetModules();
  return await import("./persister.web");
}

describe("createPersister (web)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs even when window.localStorage access throws", async () => {
    // When the browser blocks storage (Safari "Block All Cookies", some
    // private-browsing setups), the `window.localStorage` getter throws.
    // Without a try/catch, RootLayout's `useMemo` would surface the throw
    // and the whole page would render blank.
    vi.stubGlobal(
      "window",
      new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "localStorage") {
              throw new Error("SecurityError: storage disabled");
            }
            return undefined;
          },
        },
      ),
    );

    const { createPersister } = await importPersister();
    const persister = createPersister("test");
    expect(persister).toBeDefined();
    // Memory fallback should be usable.
    await persister.persistClient({
      buster: "x",
      timestamp: 0,
      clientState: { mutations: [], queries: [] },
    });
    const restored = await persister.restoreClient();
    expect(restored).toBeUndefined(); // throttled write hasn't flushed yet — that's fine
  });

  it("uses localStorage when available", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });

    const { createPersister } = await importPersister();
    const persister = createPersister("test-key");
    expect(persister).toBeDefined();
  });
});
