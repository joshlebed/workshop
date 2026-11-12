import { SHARED_TYPES_VERSION } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import { createQueryClient, getPersistBusterKey, refreshRestoredCache } from "./query";

describe("getPersistBusterKey", () => {
  it("derives a stable key from a types version", () => {
    expect(getPersistBusterKey("1")).toBe("workshop:1");
    expect(getPersistBusterKey("42")).toBe("workshop:42");
  });

  it("changes when the types version changes", () => {
    expect(getPersistBusterKey("1")).not.toBe(getPersistBusterKey("2"));
  });

  it("defaults to SHARED_TYPES_VERSION", () => {
    expect(getPersistBusterKey()).toBe(`workshop:${SHARED_TYPES_VERSION}`);
  });
});

describe("refreshRestoredCache", () => {
  it("marks restored entries stale so a reload refetches them", async () => {
    const client = createQueryClient();
    client.setQueryData(["lists"], { lists: [] });
    expect(client.getQueryState(["lists"])?.isInvalidated).toBe(false);
    await refreshRestoredCache(client);
    expect(client.getQueryState(["lists"])?.isInvalidated).toBe(true);
    expect(client.getQueryData(["lists"])).toEqual({ lists: [] });
  });
});
