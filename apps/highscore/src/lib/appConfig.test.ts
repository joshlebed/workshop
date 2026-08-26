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
    icon: string;
    name: string;
    slug: string;
    scheme: string;
    version: string;
    splash: { image: string; resizeMode: string; backgroundColor: string };
    ios: {
      bundleIdentifier: string;
      icon: string;
      associatedDomains: string[];
      infoPlist: { CFBundleURLTypes?: UrlType[] };
    };
    android: {
      adaptiveIcon: { foregroundImage: string; backgroundColor: string };
    };
    web: { favicon: string };
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

  it("wires the Icon Composer bundle plus opaque, adaptive, splash, and web assets", () => {
    expect(expo.icon).toBe("./assets/icon.png");
    expect(expo.ios.icon).toBe("./assets/HighScore.icon");
    expect(expo.splash).toEqual({
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0E0C0B",
    });
    expect(expo.android.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0E0C0B",
    });
    expect(expo.web.favicon).toBe("./public/favicon.png");

    const appDir = join(__dirname, "..", "..");
    const pngInfo = (relativePath: string) => {
      const png = readFileSync(join(appDir, relativePath), null);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      return {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        colorType: png[25],
      };
    };

    expect(pngInfo("assets/icon.png")).toEqual({ width: 1024, height: 1024, colorType: 2 });
    expect(pngInfo("assets/adaptive-icon.png")).toEqual({
      width: 1024,
      height: 1024,
      colorType: 6,
    });
    expect(pngInfo("assets/splash-icon.png")).toEqual({
      width: 512,
      height: 512,
      colorType: 6,
    });
    expect(pngInfo("public/favicon.png")).toEqual({ width: 64, height: 64, colorType: 2 });

    const iconManifest: unknown = JSON.parse(
      readFileSync(join(appDir, "assets/HighScore.icon/icon.json"), "utf8"),
    );
    expect(iconManifest).toEqual({
      fill: "system-dark",
      groups: [
        {
          layers: [
            {
              fill: "none",
              glass: false,
              "image-name": "icon-source.png",
              name: "icon-source",
              position: { scale: 0.8, "translation-in-points": [0, 0] },
            },
          ],
          shadow: { kind: "neutral", opacity: 0.5 },
          translucency: { enabled: true, value: 0.5 },
        },
      ],
      "supported-platforms": { circles: ["watchOS"], squares: "shared" },
    });
    expect(
      readFileSync(join(appDir, "assets/HighScore.icon/Assets/icon-source.png")).equals(
        readFileSync(join(appDir, "assets/icon-source.png")),
      ),
    ).toBe(true);
  });

  it("enables Sign in with Apple via the config plugin", () => {
    const names = expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain("expo-apple-authentication");
  });
});
