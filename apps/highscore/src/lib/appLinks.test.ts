import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIGHSCORE_APP_SCHEME, HIGHSCORE_APP_STORE_URL } from "@workshop/shared/constants";
import { describe, expect, it } from "vitest";
import appJson from "../../app.json";
import {
  APP_LINK_META_SELECTORS,
  buildAppLinkMetaTags,
  buildRouteAppLinkTags,
  HIGHSCORE_APP_STORE_ID,
  HIGHSCORE_NATIVE_SCHEME,
  nativeAppUrl,
  OG_META_SELECTORS,
  ROUTE_META_SELECTORS,
} from "../../functions/_lib/og.js";

const APP_DIR = join(__dirname, "..", "..");
const INDEX_HTML = readFileSync(join(APP_DIR, "public", "index.html"), "utf8");

/** Content of every `<meta {attr}="{value}" content="…">` in `html`. */
function metaContents(html: string, attr: "property" | "name", value: string): string[] {
  const re = new RegExp(`<meta\\s+${attr}="${value}"\\s+content="([^"]*)"`, "g");
  return [...html.matchAll(re)].map((m) => m[1] ?? "");
}

function selectorParts(selector: string): ["property" | "name", string] {
  const match = selector.match(/^meta\[(property|name)="(.+)"\]$/);
  if (!match) throw new Error(`unparseable selector ${selector}`);
  return [match[1] as "property" | "name", match[2] ?? ""];
}

describe("HighScore App Links metadata", () => {
  it("stays in sync with the app scheme and App Store listing", () => {
    expect(HIGHSCORE_NATIVE_SCHEME).toBe(HIGHSCORE_APP_SCHEME);
    expect(appJson.expo.scheme).toBe(HIGHSCORE_NATIVE_SCHEME);
    expect(HIGHSCORE_APP_STORE_URL.endsWith(`/id${HIGHSCORE_APP_STORE_ID}`)).toBe(true);
  });

  it("builds empty-host native URLs that expo-router resolves to the same path", () => {
    expect(nativeAppUrl("/g/abc")).toBe("highscore:///g/abc");
    expect(nativeAppUrl("friends/accept/x")).toBe("highscore:///friends/accept/x");
    expect(nativeAppUrl("/")).toBe("highscore:///");
  });

  it("emits a route's exact token, App Store id, exact web URL, and no web fallback", () => {
    const tags = buildRouteAppLinkTags("https://highscore.live/g/Ab_9-x?ref=messenger");
    expect(metaContents(tags, "property", "al:ios:url")).toEqual(["highscore:///g/Ab_9-x"]);
    expect(metaContents(tags, "property", "al:ios:app_store_id")).toEqual(["6805206753"]);
    expect(metaContents(tags, "property", "al:ios:app_name")).toEqual(["HighScore"]);
    expect(metaContents(tags, "property", "al:web:url")).toEqual([
      "https://highscore.live/g/Ab_9-x?ref=messenger",
    ]);
    expect(metaContents(tags, "property", "al:web:should_fallback")).toEqual(["false"]);
    expect(metaContents(tags, "name", "apple-itunes-app")).toEqual([
      "app-id=6805206753, app-argument=https://highscore.live/g/Ab_9-x",
    ]);
  });

  it("orders the iOS target url → app_store_id → app_name (Meta zips them by index)", () => {
    const tags = buildRouteAppLinkTags("https://highscore.live/friends/accept/t");
    const order = ["al:ios:url", "al:ios:app_store_id", "al:ios:app_name"].map((p) =>
      tags.indexOf(`property="${p}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("HTML-escapes hostile tokens and query strings", () => {
    const token = encodeURIComponent(`"><script>alert(1)</script>`);
    const tags = buildRouteAppLinkTags(
      `https://highscore.live/g/${token}?q="><img src=x onerror=alert(1)>&a=1,2`,
    );
    expect(tags).not.toMatch(/<script|<img/);
    expect(tags).not.toMatch(/content="[^"]*"[^ /]/);
    expect(metaContents(tags, "property", "al:ios:url")).toEqual([`highscore:///g/${token}`]);
    // The path is used exactly as requested: already-encoded stays single-encoded.
    expect(
      metaContents(
        buildRouteAppLinkTags("https://highscore.live/g/a%2Fb"),
        "property",
        "al:ios:url",
      ),
    ).toEqual(["highscore:///g/a%2Fb"]);
    // Raw commas would split the Smart App Banner's comma-delimited content.
    expect(buildAppLinkMetaTags({ appPath: "/", appArgument: "https://x.test/a,b" })).toContain(
      "app-argument=https://x.test/a%2Cb",
    );
  });

  it("emits exactly one tag for every App Links selector a route strips", () => {
    const tags = buildRouteAppLinkTags("https://highscore.live/g/x");
    for (const selector of APP_LINK_META_SELECTORS) {
      const [attr, value] = selectorParts(selector);
      expect(metaContents(tags, attr, value), selector).toHaveLength(1);
    }
    expect(ROUTE_META_SELECTORS).toEqual([...OG_META_SELECTORS, ...APP_LINK_META_SELECTORS]);
  });

  it("ships root defaults in index.html that route overrides fully replace", () => {
    expect(metaContents(INDEX_HTML, "property", "al:ios:url")).toEqual(["highscore:///"]);
    expect(metaContents(INDEX_HTML, "property", "al:ios:app_store_id")).toEqual([
      HIGHSCORE_APP_STORE_ID,
    ]);
    expect(metaContents(INDEX_HTML, "property", "al:ios:app_name")).toEqual(["HighScore"]);
    expect(metaContents(INDEX_HTML, "name", "apple-itunes-app")).toEqual([
      `app-id=${HIGHSCORE_APP_STORE_ID}`,
    ]);
    // Root keeps the spec defaults: web URL = this page, web fallback on.
    expect(metaContents(INDEX_HTML, "property", "al:web:url")).toEqual([]);
    expect(metaContents(INDEX_HTML, "property", "al:web:should_fallback")).toEqual([]);
    // Every App Links / banner tag in the shell is covered by a route selector.
    for (const m of INDEX_HTML.matchAll(
      /<meta\s+(property|name)="((?:al:|apple-itunes-app)[^"]*)"/g,
    )) {
      expect(ROUTE_META_SELECTORS, m[2]).toContain(`meta[${m[1]}="${m[2]}"]`);
    }
  });
});
