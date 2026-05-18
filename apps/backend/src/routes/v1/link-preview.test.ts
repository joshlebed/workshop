import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<unknown>) => next(),
}));

const { __internal, __testing, linkPreviewRoutes } = await import("./link-preview.js");

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

afterEach(() => {
  resetConfigForTesting();
  __testing.reset();
});

function authHeaders(): { Authorization: string } {
  return { Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}` };
}

const okProbe = async () => ({ ok: true });
const failProbe = async () => ({ ok: false });

function noCacheDeps() {
  return {
    lookupCache: async () => null,
    upsertCache: async () => undefined,
    probeImageFn: okProbe,
    fetchOembedFn: async () => null,
    fetchOembedDiscoveredFn: async () => null,
    runSiteHandlerFn: async () => null,
  };
}

describe("parseOgMeta", () => {
  it("prefers og: tags over twitter: and <title>", () => {
    const html = `
      <html><head>
        <title>Fallback Title</title>
        <meta property="og:title" content="Best Title">
        <meta name="twitter:title" content="Twitter Title">
        <meta property="og:image" content="https://cdn.example/img.jpg">
        <meta property="og:site_name" content="Example">
        <meta property="og:description" content="Cool stuff">
      </head><body>...</body></html>`;
    const meta = __internal.parseOgMeta(html);
    expect(meta).toEqual({
      title: "Best Title",
      description: "Cool stuff",
      image: "https://cdn.example/img.jpg",
      siteName: "Example",
    });
  });

  it("falls back to twitter: tags then <title>", () => {
    const html = `
      <html><head>
        <title>The Title</title>
        <meta name="twitter:image" content="https://cdn.example/t.jpg">
      </head></html>`;
    const meta = __internal.parseOgMeta(html);
    expect(meta.title).toBe("The Title");
    expect(meta.image).toBe("https://cdn.example/t.jpg");
    expect(meta.siteName).toBeNull();
  });

  it("decodes HTML entities", () => {
    const html = `<head><meta property="og:title" content="A &amp; B"></head>`;
    expect(__internal.parseOgMeta(html).title).toBe("A & B");
  });

  it("tolerates single-quoted and unquoted attribute values", () => {
    const html = `<head><meta property='og:title' content='Quoted'></head>`;
    expect(__internal.parseOgMeta(html).title).toBe("Quoted");
  });

  it("returns nulls when nothing is present", () => {
    const meta = __internal.parseOgMeta("<html><head></head><body></body></html>");
    expect(meta).toEqual({ title: null, description: null, image: null, siteName: null });
  });
});

describe("collectImageCandidates", () => {
  it("collects og:image with width/height, twitter, msapp tile, itemprop, image_src", () => {
    const html = `
      <head>
        <meta property="og:image" content="https://cdn.example/og.jpg">
        <meta property="og:image:width" content="800">
        <meta property="og:image:height" content="600">
        <meta name="twitter:image" content="https://cdn.example/tw.jpg">
        <meta name="msapplication-TileImage" content="/tile.png">
        <meta itemprop="image" content="/item.png">
        <link rel="image_src" href="/legacy.png">
      </head>`;
    const c = __internal.collectImageCandidates(html);
    const byUrl = Object.fromEntries(c.map((x) => [x.url, x]));
    expect(byUrl["https://cdn.example/og.jpg"]).toMatchObject({ width: 800, height: 600 });
    expect(byUrl["https://cdn.example/tw.jpg"]).toMatchObject({ width: null, height: null });
    expect(c.map((x) => x.url)).toEqual(
      expect.arrayContaining([
        "https://cdn.example/og.jpg",
        "https://cdn.example/tw.jpg",
        "/tile.png",
        "/item.png",
        "/legacy.png",
      ]),
    );
    // og:image must outrank twitter:image; both outrank legacy fields.
    const ogRank = byUrl["https://cdn.example/og.jpg"]?.rank ?? 0;
    const twitterRank = byUrl["https://cdn.example/tw.jpg"]?.rank ?? 0;
    const tileRank = byUrl["/tile.png"]?.rank ?? 0;
    expect(ogRank).toBeGreaterThan(twitterRank);
    expect(twitterRank).toBeGreaterThan(tileRank);
  });

  it("prefers og:image:secure_url over og:image when both exist", () => {
    const html = `
      <head>
        <meta property="og:image" content="http://cdn.example/og.jpg">
        <meta property="og:image:secure_url" content="https://cdn.example/og.jpg">
      </head>`;
    const c = __internal.collectImageCandidates(html);
    expect(c.find((x) => x.rank === 80)?.url).toBe("https://cdn.example/og.jpg");
  });

  it("extracts images from JSON-LD strings, ImageObjects, arrays, and @graph", () => {
    const html = `
      <head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"VideoGame","image":"https://cdn.example/game.jpg"}
        </script>
        <script type="application/ld+json">
          {"@graph":[{"@type":"Product","image":[{"@type":"ImageObject","url":"https://cdn.example/p1.jpg","width":512,"height":512},"https://cdn.example/p2.jpg"]}]}
        </script>
      </head>`;
    const c = __internal.collectImageCandidates(html);
    const urls = c.map((x) => x.url);
    expect(urls).toContain("https://cdn.example/game.jpg");
    expect(urls).toContain("https://cdn.example/p1.jpg");
    expect(urls).toContain("https://cdn.example/p2.jpg");
    const sized = c.find((x) => x.url === "https://cdn.example/p1.jpg");
    expect(sized).toMatchObject({ width: 512, height: 512 });
  });

  it("ignores JSON-LD blocks that don't parse", () => {
    const html = `<head><script type="application/ld+json">{not json}</script></head>`;
    expect(__internal.collectImageCandidates(html)).toEqual([]);
  });
});

describe("isLowQualityImage", () => {
  it("rejects data: URLs but accepts inline SVG", () => {
    expect(
      __internal.isLowQualityImage({
        url: "data:image/gif;base64,R0lGOD",
        width: null,
        height: null,
      }),
    ).toBe(true);
    expect(
      __internal.isLowQualityImage({
        url: "data:image/svg+xml;base64,PHN2Zy8+",
        width: null,
        height: null,
      }),
    ).toBe(false);
  });

  it("rejects tracking-pixel-ish filenames", () => {
    for (const url of [
      "https://t.example/1x1.gif",
      "https://t.example/spacer.gif",
      "https://cdn.example/transparent.png",
      "https://cdn.example/tracking-pixel.png",
      "https://cdn.example/beacon.gif",
    ]) {
      expect(__internal.isLowQualityImage({ url, width: null, height: null })).toBe(true);
    }
  });

  it("rejects declared dimensions below the threshold", () => {
    expect(__internal.isLowQualityImage({ url: "https://x/tiny.png", width: 64, height: 64 })).toBe(
      true,
    );
    expect(__internal.isLowQualityImage({ url: "https://x/ok.png", width: 600, height: 400 })).toBe(
      false,
    );
  });

  it("accepts banner-style filenames with mid-size dimensions baked in", () => {
    expect(
      __internal.isLowQualityImage({
        url: "https://cdn.example/promo-300x250.jpg",
        width: null,
        height: null,
      }),
    ).toBe(false);
  });
});

describe("pickValidatedImage", () => {
  const base = new URL("https://www.example.com/");

  it("picks the highest-ranked candidate when dimensions are pre-declared", async () => {
    const picked = await __internal.pickValidatedImage(
      [
        { url: "https://cdn.example/og.jpg", width: 800, height: 600, rank: 80 },
        { url: "https://cdn.example/tw.jpg", width: null, height: null, rank: 70 },
      ],
      base,
      okProbe,
    );
    expect(picked).toBe("https://cdn.example/og.jpg");
  });

  it("probes when dimensions are missing and uses the first valid hit", async () => {
    const calls: string[] = [];
    const probe = async (u: string) => {
      calls.push(u);
      return { ok: u.endsWith("good.jpg") };
    };
    const picked = await __internal.pickValidatedImage(
      [
        { url: "https://cdn.example/bad.jpg", width: null, height: null, rank: 80 },
        { url: "https://cdn.example/good.jpg", width: null, height: null, rank: 70 },
      ],
      base,
      probe,
    );
    expect(picked).toBe("https://cdn.example/good.jpg");
    expect(calls).toEqual(["https://cdn.example/bad.jpg", "https://cdn.example/good.jpg"]);
  });

  it("falls back to lower-rank candidate when higher-rank fails the probe", async () => {
    const picked = await __internal.pickValidatedImage(
      [
        { url: "https://cdn.example/dead.jpg", width: null, height: null, rank: 100 },
        { url: "https://cdn.example/alive.jpg", width: 600, height: 400, rank: 60 },
      ],
      base,
      failProbe,
    );
    expect(picked).toBe("https://cdn.example/alive.jpg");
  });

  it("returns null when every candidate fails", async () => {
    const picked = await __internal.pickValidatedImage(
      [{ url: "https://cdn.example/x.jpg", width: null, height: null, rank: 80 }],
      base,
      failProbe,
    );
    expect(picked).toBeNull();
  });

  it("dedupes the same absolute URL across ranks", async () => {
    let calls = 0;
    const probe = async () => {
      calls++;
      return { ok: false };
    };
    await __internal.pickValidatedImage(
      [
        { url: "https://cdn.example/same.jpg", width: null, height: null, rank: 80 },
        { url: "https://cdn.example/same.jpg", width: null, height: null, rank: 70 },
      ],
      base,
      probe,
    );
    expect(calls).toBe(1);
  });
});

describe("collectFaviconCandidates / pickFavicon", () => {
  const base = new URL("https://www.example.com/");

  it("prefers apple-touch-icon over icon and shortcut icon", () => {
    const html = `
      <head>
        <link rel="shortcut icon" href="/favicon.ico">
        <link rel="icon" sizes="32x32" href="/icon-32.png">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      </head>`;
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(html), base);
    expect(picked).toBe("https://www.example.com/apple-touch-icon.png");
  });

  it("accepts an icon link with a large declared size when no apple-touch-icon", () => {
    const html = `
      <head>
        <link rel="icon" sizes="192x192" href="/icon-192.png">
        <link rel="shortcut icon" href="/favicon.ico">
      </head>`;
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(html), base);
    expect(picked).toBe("https://www.example.com/icon-192.png");
  });

  it("accepts SVG icons even without a sizes attribute", () => {
    const html = `<head><link rel="icon" href="/icon.svg"></head>`;
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(html), base);
    expect(picked).toBe("https://www.example.com/icon.svg");
  });

  it("falls back to Google s2 when only a tiny shortcut icon is declared", () => {
    const html = `<head><link rel="shortcut icon" href="/favicon.ico"></head>`;
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(html), base);
    expect(picked).toBe("https://www.google.com/s2/favicons?domain=www.example.com&sz=128");
  });

  it("falls back to Google s2 when the page declares no icon at all", () => {
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(""), base);
    expect(picked).toBe("https://www.google.com/s2/favicons?domain=www.example.com&sz=128");
  });

  it("picks the largest declared size when several icons exist at the same rel", () => {
    const html = `
      <head>
        <link rel="icon" sizes="64x64" href="/icon-64.png">
        <link rel="icon" sizes="256x256" href="/icon-256.png">
      </head>`;
    const picked = __internal.pickFavicon(__internal.collectFaviconCandidates(html), base);
    expect(picked).toBe("https://www.example.com/icon-256.png");
  });
});

describe("cacheKeyFor", () => {
  it("is stable for the same URL and differs across URLs", () => {
    const a = __internal.cacheKeyFor(new URL("https://example.com/a"));
    const b = __internal.cacheKeyFor(new URL("https://example.com/b"));
    const a2 = __internal.cacheKeyFor(new URL("https://example.com/a"));
    expect(a).toEqual(a2);
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("buildPreview", () => {
  const noDiscovery = async () => null;

  it("resolves relative og:image against finalUrl and emits an imageProxy", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/page"),
      {
        finalUrl: new URL("https://www.example.com/canonical"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:title" content="T">
          <meta property="og:image" content="/static/img.jpg">
          <meta property="og:image:width" content="800">
          <meta property="og:image:height" content="600">
        </head>`,
      },
      null,
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.image).toBe("https://www.example.com/static/img.jpg");
    expect(preview.url).toBe("https://example.com/page");
    expect(preview.finalUrl).toBe("https://www.example.com/canonical");
    expect(preview.imageProxy).toMatch(/^https:\/\/wsrv\.nl\/\?url=/);
    expect(preview.imageProxy).toContain(
      encodeURIComponent("https://www.example.com/static/img.jpg"),
    );
    expect(preview.source).toBe("html");
  });

  it("falls back to finalUrl hostname when no og:site_name", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/x"),
      {
        finalUrl: new URL("https://www.example.com/x"),
        contentType: "text/html",
        body: `<head><meta property="og:title" content="T"></head>`,
      },
      null,
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.siteName).toBe("www.example.com");
  });

  it("prefers oEmbed thumbnail over og:image when both present", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:title" content="T">
          <meta property="og:image" content="https://cdn.example/og.jpg">
          <meta property="og:image:width" content="800">
          <meta property="og:image:height" content="600">
        </head>`,
      },
      {
        thumbnailUrl: "https://cdn.oembed/hero.jpg",
        thumbnailWidth: 1280,
        thumbnailHeight: 720,
        title: "From oEmbed",
        authorName: null,
        providerName: "ExampleProvider",
      },
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.image).toBe("https://cdn.oembed/hero.jpg");
    expect(preview.source).toBe("oembed");
  });

  it("prefers a site-handler image over oEmbed and og:image", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:image" content="https://cdn.example/og.jpg">
          <meta property="og:image:width" content="800">
          <meta property="og:image:height" content="600">
        </head>`,
      },
      {
        thumbnailUrl: "https://cdn.oembed/hero.jpg",
        thumbnailWidth: 1280,
        thumbnailHeight: 720,
        title: null,
        authorName: null,
        providerName: null,
      },
      {
        image: "https://cdn.site/forced.jpg",
        title: "Forced Title",
        description: null,
        handler: "test",
      },
      okProbe,
      noDiscovery,
    );
    expect(preview.image).toBe("https://cdn.site/forced.jpg");
    expect(preview.title).toBe("Forced Title");
    expect(preview.source).toBe("site");
  });

  it("falls through to og:image when the site-handler image fails the probe", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:image" content="https://cdn.example/og.jpg">
          <meta property="og:image:width" content="800">
          <meta property="og:image:height" content="600">
        </head>`,
      },
      null,
      {
        image: "https://cdn.site/dead.jpg",
        title: null,
        description: null,
        handler: "test",
      },
      async (u: string) => ({ ok: !u.includes("dead") }),
      noDiscovery,
    );
    expect(preview.image).toBe("https://cdn.example/og.jpg");
    // Source still reflects that the site handler matched — only the image fell through.
    expect(preview.source).toBe("site");
  });

  it("uses oEmbed discovery when no registry hit and a discovery link is in the head", async () => {
    let endpointReceived: string | null = null;
    const preview = await __internal.buildPreview(
      new URL("https://wp.example/post"),
      {
        finalUrl: new URL("https://wp.example/post"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:title" content="T">
          <link rel="alternate" type="application/json+oembed" href="https://wp.example/oembed?url=foo">
        </head>`,
      },
      null,
      null,
      okProbe,
      async (endpoint: string) => {
        endpointReceived = endpoint;
        return {
          thumbnailUrl: "https://cdn.wp/discovered.jpg",
          thumbnailWidth: 600,
          thumbnailHeight: 400,
          title: null,
          authorName: null,
          providerName: null,
        };
      },
    );
    expect(endpointReceived).toBe("https://wp.example/oembed?url=foo");
    expect(preview.image).toBe("https://cdn.wp/discovered.jpg");
    expect(preview.source).toBe("oembed");
  });

  it("falls back to a Google-s2 favicon when nothing on the page meets the bar", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head><link rel="shortcut icon" href="/favicon.ico"></head>`,
      },
      null,
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.favicon).toBe(
      "https://www.google.com/s2/favicons?domain=www.example.com&sz=128",
    );
  });

  it("skips low-quality image candidates and tries the next source", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:image" content="https://cdn.example/pixel-1x1.gif">
          <meta name="twitter:image" content="https://cdn.example/hero.jpg">
        </head>`,
      },
      null,
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.image).toBe("https://cdn.example/hero.jpg");
  });

  it("returns null image when every candidate is low-quality", async () => {
    const preview = await __internal.buildPreview(
      new URL("https://example.com/p"),
      {
        finalUrl: new URL("https://www.example.com/p"),
        contentType: "text/html",
        body: `<head>
          <meta property="og:image" content="https://cdn.example/tracker.gif">
          <meta property="og:image:width" content="1">
          <meta property="og:image:height" content="1">
        </head>`,
      },
      null,
      null,
      okProbe,
      noDiscovery,
    );
    expect(preview.image).toBeNull();
    expect(preview.imageProxy).toBeNull();
  });
});

describe("buildPreviewFromHints", () => {
  it("builds a usable preview from just a site-handler result", () => {
    const preview = __internal.buildPreviewFromHints(
      new URL("https://x.com/jack/status/1"),
      {
        image: "https://cdn.x/pic.jpg",
        title: "Jack on X",
        description: "Hello world",
        handler: "fxtwitter",
      },
      null,
    );
    expect(preview.image).toBe("https://cdn.x/pic.jpg");
    expect(preview.imageProxy).toMatch(/^https:\/\/wsrv\.nl\/\?url=/);
    expect(preview.source).toBe("site");
    expect(preview.title).toBe("Jack on X");
    expect(preview.favicon).toContain("google.com/s2/favicons");
  });

  it("builds a usable preview from just an oEmbed result", () => {
    const preview = __internal.buildPreviewFromHints(
      new URL("https://www.youtube.com/watch?v=abc"),
      null,
      {
        thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        thumbnailWidth: 480,
        thumbnailHeight: 360,
        title: "Cool video",
        authorName: "Some Channel",
        providerName: "YouTube",
      },
    );
    expect(preview.image).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    expect(preview.title).toBe("Cool video");
    expect(preview.siteName).toBe("YouTube");
    expect(preview.source).toBe("oembed");
  });
});

describe("GET /v1/link-preview auth + validation", () => {
  it("requires a bearer token", async () => {
    const res = await linkPreviewRoutes.request("/?url=https://example.com/");
    expect(res.status).toBe(401);
  });

  it("rejects empty url", async () => {
    const res = await linkPreviewRoutes.request("/?url=", { headers: authHeaders() });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("rejects unparseable url", async () => {
    const res = await linkPreviewRoutes.request("/?url=not-a-url", { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("rejects non-http(s) protocol", async () => {
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("file:///etc/passwd")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/link-preview SSRF blocks", () => {
  it("blocks AWS metadata IP at validation", async () => {
    let fetched = 0;
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        fetched++;
        throw new Error("should not fetch");
      },
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
    expect(fetched).toBe(0);
  });

  it("blocks localhost literal at validation", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new Error("should not fetch");
      },
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("http://127.0.0.1/")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(400);
  });

  it("blocks RFC1918 literal at validation", async () => {
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("http://10.0.0.1/admin")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(400);
  });

  it("blocks userinfo URLs", async () => {
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("http://user:pw@example.com/")}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/link-preview happy paths", () => {
  it("returns parsed preview when fetcher succeeds", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        body: `
          <html><head>
            <meta property="og:title" content="Cool Page">
            <meta property="og:description" content="Stuff">
            <meta property="og:image" content="https://cdn.example/i.jpg">
            <meta property="og:image:width" content="800">
            <meta property="og:image:height" content="600">
            <meta property="og:site_name" content="ExampleSite">
            <link rel="icon" sizes="192x192" href="/icon.png">
          </head></html>`,
      }),
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://example.com/p")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };
    expect(body.preview).toMatchObject({
      url: "https://example.com/p",
      finalUrl: "https://example.com/p",
      title: "Cool Page",
      description: "Stuff",
      image: "https://cdn.example/i.jpg",
      favicon: "https://example.com/icon.png",
      siteName: "ExampleSite",
      source: "html",
    });
    expect(body.preview.imageProxy).toMatch(/^https:\/\/wsrv\.nl\//);
    expect(typeof body.preview.fetchedAt).toBe("string");
  });

  it("falls back to site-handler-only preview when page fetch fails", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new Error("upstream 401");
      },
      runSiteHandlerFn: async () => ({
        image: "https://cdn.site/hero.jpg",
        title: "Jack on X",
        description: "Hi",
        handler: "fxtwitter",
      }),
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://x.com/jack/status/1")}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };
    expect(body.preview).toMatchObject({
      title: "Jack on X",
      image: "https://cdn.site/hero.jpg",
      source: "site",
    });
  });

  it("falls back to oEmbed-only preview when page fetch exceeds the body cap", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new Error("response body exceeded 3000000 bytes");
      },
      fetchOembedFn: async () => ({
        thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        thumbnailWidth: 480,
        thumbnailHeight: 360,
        title: "Cool",
        authorName: null,
        providerName: "YouTube",
      }),
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://www.youtube.com/watch?v=abc")}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };
    expect(body.preview).toMatchObject({
      image: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      source: "oembed",
      siteName: "YouTube",
    });
  });

  it("returns the cached preview without invoking the fetcher", async () => {
    let fetcherCalls = 0;
    const cachedPreview = {
      url: "https://example.com/x",
      finalUrl: "https://example.com/x",
      title: "Cached",
      description: null,
      image: null,
      imageProxy: null,
      favicon: null,
      siteName: "example.com",
      source: "html",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    __testing.setDeps({
      lookupCache: (async () => ({ data: cachedPreview })) as <T>() => Promise<{ data: T } | null>,
      upsertCache: async () => undefined,
      probeImageFn: okProbe,
      fetchOembedFn: async () => null,
      fetchOembedDiscoveredFn: async () => null,
      runSiteHandlerFn: async () => null,
      fetchPage: async () => {
        fetcherCalls++;
        throw new Error("should not fetch");
      },
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://example.com/x")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
    expect(fetcherCalls).toBe(0);
    const body = (await res.json()) as { preview: { title: string } };
    expect(body.preview.title).toBe("Cached");
  });

  it("returns 500 INTERNAL when both the fetcher and site-handler return nothing", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new Error("upstream 500");
      },
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://example.com/y")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL" });
  });

  it("returns 400 VALIDATION when the fetcher throws SsrfBlockedError (e.g. redirect rebind)", async () => {
    const { SsrfBlockedError } = await import("../../lib/ssrf-guard.js");
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new SsrfBlockedError("attacker.example", "ipv4 range: private for 10.0.0.1");
      },
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://attacker.example/")}`,
      { headers: authHeaders() },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("does not fail the response if the cache write rejects", async () => {
    __testing.setDeps({
      lookupCache: async () => null,
      upsertCache: async () => {
        throw new Error("cache exploded");
      },
      probeImageFn: okProbe,
      fetchOembedFn: async () => null,
      fetchOembedDiscoveredFn: async () => null,
      runSiteHandlerFn: async () => null,
      fetchPage: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        body: `<head><meta property="og:title" content="OK"></head>`,
      }),
    });
    const res = await linkPreviewRoutes.request(
      `/?url=${encodeURIComponent("https://example.com/z")}`,
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
  });
});
