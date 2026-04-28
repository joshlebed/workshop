import { SHARED_TYPES_VERSION } from "@workshop/shared";
import { describe, expect, it } from "vitest";
import { getPersistBusterKey, PERSIST_TYPES_VERSION } from "./query";

describe("getPersistBusterKey", () => {
  it("derives a stable key from a types version", () => {
    expect(getPersistBusterKey("1")).toBe("workshop:1");
    expect(getPersistBusterKey("42")).toBe("workshop:42");
  });

  it("changes when the types version changes", () => {
    expect(getPersistBusterKey("1")).not.toBe(getPersistBusterKey("2"));
  });

  it("defaults to the local PERSIST_TYPES_VERSION", () => {
    expect(getPersistBusterKey()).toBe(`workshop:${PERSIST_TYPES_VERSION}`);
  });

  it("stays in lock-step with packages/shared SHARED_TYPES_VERSION", () => {
    // If this fails, you bumped one but not the other. Bump both — see the
    // comment in apps/workshop/src/lib/query.ts.
    expect(PERSIST_TYPES_VERSION).toBe(SHARED_TYPES_VERSION);
  });
});
