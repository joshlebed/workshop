import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the iOS config invariants that only surface as a broken build or a
// dead deep link. `npx expo config --type public` catches some of these, but
// it needs a full install and doesn't run in CI — these assertions are cheap
// and pin the exact values the Apple/Google registrations were created against.
const APP_JSON = join(__dirname, "..", "..", "app.json");

interface UrlType {
  CFBundleURLSchemes?: string[];
}

interface AppJson {
  expo: {
    name: string;
    slug: string;
    scheme: string;
    version: string;
    ios: {
      bundleIdentifier: string;
      associatedDomains: string[];
      infoPlist: { CFBundleURLTypes?: UrlType[] };
    };
    plugins: (string | [string, unknown])[];
  };
}

function readAppJson(): AppJson {
  const parsed: unknown = JSON.parse(readFileSync(APP_JSON, "utf8"));
  return parsed as AppJson;
}

const GOOGLE_IOS_CLIENT_ID = "267582241036-7vtcgkd594ldgimcu3dickj9u5ga951l";

describe("apps/highscore app.json", () => {
  const { expo } = readAppJson();
  const schemes = (expo.ios.infoPlist.CFBundleURLTypes ?? []).flatMap(
    (entry) => entry.CFBundleURLSchemes ?? [],
  );

  it("declares the HighScore identity the Apple/Google registrations were made against", () => {
    expect(expo.name).toBe("HighScore");
    expect(expo.slug).toBe("highscore");
    expect(expo.scheme).toBe("highscore");
    expect(expo.ios.bundleIdentifier).toBe("live.highscore.app");
    expect(expo.ios.associatedDomains).toEqual(["applinks:highscore.live"]);
  });

  // Once `ios.infoPlist.CFBundleURLTypes` is declared, Expo stops auto-adding
  // the root `scheme:` value — it has to be re-listed by hand or every
  // `highscore://` deep link (including expo-router's own) dies on device.
  it("re-lists the app scheme in CFBundleURLTypes alongside Google's reverse scheme", () => {
    expect(schemes).toContain("highscore");
    expect(schemes).toContain(`com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID}`);
  });

  // Runtime-version policy is `appVersion`, so this string is what OTAs target.
  it("pins a runtime version that OTA updates can target", () => {
    expect(expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("enables Sign in with Apple via the config plugin", () => {
    const names = expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain("expo-apple-authentication");
  });
});
