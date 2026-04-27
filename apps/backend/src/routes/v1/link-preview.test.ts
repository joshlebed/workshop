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

function noCacheDeps() {
  return {
    lookupCache: async () => null,
    upsertCache: async () => undefined,
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
  it("resolves relative og:image against finalUrl", () => {
    const preview = __internal.buildPreview(new URL("https://example.com/page"), {
      finalUrl: new URL("https://www.example.com/canonical"),
      contentType: "text/html",
      body: `<head><meta property="og:title" content="T"><meta property="og:image" content="/static/img.jpg"></head>`,
    });
    expect(preview.image).toBe("https://www.example.com/static/img.jpg");
    expect(preview.url).toBe("https://example.com/page");
    expect(preview.finalUrl).toBe("https://www.example.com/canonical");
  });

  it("falls back to finalUrl hostname when no og:site_name", () => {
    const preview = __internal.buildPreview(new URL("https://example.com/x"), {
      finalUrl: new URL("https://www.example.com/x"),
      contentType: "text/html",
      body: `<head><meta property="og:title" content="T"></head>`,
    });
    expect(preview.siteName).toBe("www.example.com");
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
      "/?url=" + encodeURIComponent("file:///etc/passwd"),
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
      "/?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data/"),
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
      "/?url=" + encodeURIComponent("http://127.0.0.1/"),
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(400);
  });

  it("blocks RFC1918 literal at validation", async () => {
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("http://10.0.0.1/admin"),
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(400);
  });

  it("blocks userinfo URLs", async () => {
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("http://user:pw@example.com/"),
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
            <meta property="og:site_name" content="ExampleSite">
          </head></html>`,
      }),
    });
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("https://example.com/p"),
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
      siteName: "ExampleSite",
    });
    expect(typeof body.preview.fetchedAt).toBe("string");
  });

  it("returns the cached preview without invoking the fetcher", async () => {
    let fetcherCalls = 0;
    const cachedPreview = {
      url: "https://example.com/x",
      finalUrl: "https://example.com/x",
      title: "Cached",
      description: null,
      image: null,
      siteName: "example.com",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };
    __testing.setDeps({
      lookupCache: (async () => ({ data: cachedPreview })) as <T>() => Promise<{ data: T } | null>,
      upsertCache: async () => undefined,
      fetchPage: async () => {
        fetcherCalls++;
        throw new Error("should not fetch");
      },
    });
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("https://example.com/x"),
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
    expect(fetcherCalls).toBe(0);
    const body = (await res.json()) as { preview: { title: string } };
    expect(body.preview.title).toBe("Cached");
  });

  it("returns 500 INTERNAL when the fetcher throws a non-SSRF error", async () => {
    __testing.setDeps({
      ...noCacheDeps(),
      fetchPage: async () => {
        throw new Error("upstream 500");
      },
    });
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("https://example.com/y"),
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
      "/?url=" + encodeURIComponent("https://attacker.example/"),
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
      fetchPage: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        body: `<head><meta property="og:title" content="OK"></head>`,
      }),
    });
    const res = await linkPreviewRoutes.request(
      "/?url=" + encodeURIComponent("https://example.com/z"),
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
  });
});
