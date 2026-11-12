import { describe, expect, it } from "vitest";
import { focusedStack, type NavState, resolveBack, routePath } from "./backResolver";

const lists = (routes: NavState["routes"], index = routes.length - 1): NavState => ({
  index: 0,
  routes: [
    {
      name: "(tabs)",
      state: { index: 0, routes: [{ name: "(lists)", state: { index, routes } }] },
    },
  ],
});

describe("routePath", () => {
  it("fills dynamic segments and drops groups and a trailing index", () => {
    expect(routePath("index", { id: "a" })).toBe("/");
    expect(routePath("list/[id]/index", { id: "a" })).toBe("/list/a");
    expect(routePath("list/[id]/add", { id: "a" })).toBe("/list/a/add");
    expect(routePath("(tabs)/(lists)/settings/index", undefined)).toBe("/settings");
  });
});

describe("focusedStack", () => {
  it("walks to the innermost navigator on the focused path", () => {
    const stack = focusedStack(
      lists([{ name: "index" }, { name: "list/[id]/index", params: { id: "a" } }]),
    );
    expect(stack?.routes.map((r) => r.name)).toEqual(["index", "list/[id]/index"]);
  });
});

describe("resolveBack (goBack fallbacks)", () => {
  const home = { name: "index" };
  const listA = { name: "list/[id]/index", params: { id: "a" } };
  const addA = { name: "list/[id]/add", params: { id: "a" } };

  it("pops when the screen beneath is the parent", () => {
    expect(resolveBack(focusedStack(lists([home, listA, addA])), "/list/a", true)).toBe("back");
    expect(resolveBack(focusedStack(lists([home, listA])), "/", true)).toBe("back");
  });

  it("goes to the parent list when a modal was opened cold over the home anchor", () => {
    // /list/a/add opened directly: the anchor injects home (with the deep link's
    // params) beneath it. A plain back used to land on `/?id=a`.
    const coldHome = { name: "index", params: { id: "a" } };
    expect(resolveBack(focusedStack(lists([coldHome, addA])), "/list/a", true)).toBe(
      "dismissToParent",
    );
    expect(
      resolveBack(
        focusedStack(lists([coldHome, { name: "list/[id]/settings", params: { id: "a" } }])),
        "/list/a",
        true,
      ),
    ).toBe("dismissToParent");
  });

  it("keeps real history: a screen reached from somewhere else pops back there", () => {
    const settings = { name: "settings/index" };
    const profile = { name: "profile" };
    expect(resolveBack(focusedStack(lists([home, settings, profile])), "/settings", true)).toBe(
      "back",
    );
    expect(
      resolveBack(
        focusedStack(
          lists([
            home,
            listA,
            { name: "list/[id]/item/[itemId]", params: { id: "b", itemId: "x" } },
          ]),
        ),
        "/list/b",
        true,
      ),
    ).toBe("back");
  });

  it("with nothing beneath, pops an outer navigator or replaces with the parent", () => {
    expect(resolveBack(focusedStack(lists([listA])), "/", true)).toBe("back");
    expect(resolveBack(focusedStack(lists([listA])), "/", false)).toBe("replaceWithParent");
    expect(resolveBack(null, "/list/a", false)).toBe("replaceWithParent");
  });

  it("ignores a query string on the parent href", () => {
    expect(resolveBack(focusedStack(lists([home, listA, addA])), "/list/a?x=1", true)).toBe("back");
  });
});
