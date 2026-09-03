import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicRoute, PRIVACY_ROUTE, PUBLIC_ROUTES, SUPPORT_ROUTE } from "./publicRoutes";

const APP_DIR = join(__dirname, "..", "..", "app");
const readApp = (...parts: string[]) => readFileSync(join(APP_DIR, ...parts), "utf8");

describe("public routes", () => {
  it("pins the canonical URLs published to the App Store", () => {
    // Changing either literal breaks a URL registered in App Store Connect.
    expect(SUPPORT_ROUTE).toBe("/support");
    expect(PRIVACY_ROUTE).toBe("/privacy");
    expect(PUBLIC_ROUTES).toEqual(["/support", "/privacy"]);
  });

  it("recognises the public routes, with or without group segments", () => {
    expect(isPublicRoute(["support"])).toBe(true);
    expect(isPublicRoute(["privacy"])).toBe(true);
    expect(isPublicRoute(["(tabs)", "privacy"])).toBe(true);
  });

  it("leaves every authenticated route gated", () => {
    expect(isPublicRoute([])).toBe(false);
    expect(isPublicRoute(["(tabs)"])).toBe(false);
    expect(isPublicRoute(["(tabs)", "index"])).toBe(false);
    expect(isPublicRoute(["friends"])).toBe(false);
    expect(isPublicRoute(["games", "[id]"])).toBe(false);
    expect(isPublicRoute(["profile"])).toBe(false);
    expect(isPublicRoute(["sign-in"])).toBe(false);
    expect(isPublicRoute(["supporters"])).toBe(false);
    expect(isPublicRoute(["privacy-policy"])).toBe(false);
  });

  it("ships a route file for each public URL", () => {
    for (const route of PUBLIC_ROUTES) {
      expect(readApp(`${route.slice(1)}.tsx`)).toContain("export default");
    }
  });

  // The redirect bypass lives in a React effect that vitest (node env, no
  // renderer) can't drive, so assert the wiring instead: the auth gate has to
  // consult `isPublicRoute` before it redirects a signed-out visitor and
  // before either blocking interstitial.
  it("lets the auth gate skip redirects and interstitials on public routes", () => {
    const layout = readApp("_layout.tsx");
    expect(layout).toContain('import { isPublicRoute } from "../src/lib/publicRoutes"');
    expect(layout).toContain("const onPublicRoute = isPublicRoute(segments);");
    expect(layout).toContain("if (onPublicRoute) return;");
    expect(layout).toContain('if (status === "loading" && !onPublicRoute) {');
    expect(layout).toContain('if (status === "unavailable" && !onPublicRoute) {');
    for (const route of PUBLIC_ROUTES) {
      expect(layout).toContain(`<Stack.Screen name="${route.slice(1)}"`);
    }
  });

  // Apple checks that a signed-in user can reach both published URLs from
  // inside the app. They hang off the YOU screen (the profile menu sheet it
  // replaced is gone).
  it("links both pages from the signed-in YOU screen", () => {
    const you = readFileSync(join(__dirname, "..", "screens", "You.tsx"), "utf8");
    expect(you).toContain('import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes"');
    expect(you).toContain('label="Support"');
    expect(you).toContain("router.push(SUPPORT_ROUTE)");
    expect(you).toContain('label="Privacy"');
    expect(you).toContain("router.push(PRIVACY_ROUTE)");
  });
});
