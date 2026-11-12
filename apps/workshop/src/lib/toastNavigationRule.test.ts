import { describe, expect, it } from "vitest";
import { collectRouteKeys, openedNewScreen } from "./toastNavigationRule";

const home = { key: "home" };
const list = { key: "list-a" };
const add = { key: "add-a" };
const stack = (routes: { key: string }[]) => ({
  routes: [
    {
      key: "tabs",
      state: { routes: [{ key: "lists", state: { routes, index: routes.length - 1 } }] },
    },
  ],
  index: 0,
});

describe("toast navigation rule", () => {
  it("collects every key and the focused leaf", () => {
    const { focused, all } = collectRouteKeys(stack([home, list]));
    expect(focused).toBe("list-a");
    expect([...all].sort()).toEqual(["home", "lists", "list-a", "tabs"].sort());
  });

  it("a push or modal opens a new screen", () => {
    const before = collectRouteKeys(stack([home, list])).all;
    expect(openedNewScreen(before, stack([home, list, add]))).toBe(true);
  });

  it("going back does not", () => {
    const before = collectRouteKeys(stack([home, list, add])).all;
    expect(openedNewScreen(before, stack([home, list]))).toBe(false);
  });

  it("the first state never dismisses", () => {
    expect(openedNewScreen(null, stack([home]))).toBe(false);
  });

  it("ignores malformed state", () => {
    expect(collectRouteKeys(undefined).focused).toBeNull();
    expect(openedNewScreen(new Set(["a"]), { nope: true })).toBe(false);
  });
});
