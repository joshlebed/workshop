import { describe, expect, it } from "vitest";
import {
  buildProxyUrl,
  googleFaviconUrl,
  probeImage,
  readImageDimensions,
} from "./image-validation.js";

// Bypass the DNS-based SSRF guard for unit tests — none of these hostnames
// resolve, and we're already feeding probeImage a synthetic fetcher.
const allowAnyHost = async (): Promise<void> => undefined;

describe("buildProxyUrl", () => {
  it("wraps an https image URL in the wsrv.nl proxy", () => {
    const out = buildProxyUrl("https://cdn.example.com/img.jpg");
    expect(out).toBe(
      `https://wsrv.nl/?url=${encodeURIComponent("https://cdn.example.com/img.jpg")}&w=600&h=600&fit=cover&we&output=webp&n=-1`,
    );
  });

  it("returns null for falsy input", () => {
    expect(buildProxyUrl(null)).toBeNull();
    expect(buildProxyUrl("")).toBeNull();
  });

  it("returns null for data: URLs and other non-http schemes", () => {
    expect(buildProxyUrl("data:image/png;base64,xyz")).toBeNull();
    expect(buildProxyUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for unparseable URLs", () => {
    expect(buildProxyUrl("not a url")).toBeNull();
  });

  it("is idempotent — wrapping a wsrv.nl URL re-extracts the inner url=", () => {
    const inner = "https://cdn.example.com/img.jpg";
    const wrapped = buildProxyUrl(inner);
    if (!wrapped) throw new Error("wrapped should be non-null");
    const twice = buildProxyUrl(wrapped);
    expect(twice).toBe(wrapped);
  });
});

describe("googleFaviconUrl", () => {
  it("builds a Google s2 favicon URL with the host encoded", () => {
    expect(googleFaviconUrl("www.example.com")).toBe(
      "https://www.google.com/s2/favicons?domain=www.example.com&sz=128",
    );
  });

  it("trims surrounding whitespace and dots", () => {
    expect(googleFaviconUrl(" example.com. ")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=128",
    );
  });
});

describe("probeImage", () => {
  it("accepts a HEAD response that says image/* with a sane content-length", async () => {
    const fakeFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": "120000",
        },
      })) as unknown as typeof fetch;
    const r = await probeImage("https://cdn.example.com/x.jpg", fakeFetch, allowAnyHost);
    expect(r.ok).toBe(true);
    expect(r.byteLength).toBe(120000);
  });

  it("rejects a HEAD response that is not image/*", async () => {
    const fakeFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const r = await probeImage("https://cdn.example.com/x", fakeFetch, allowAnyHost);
    expect(r.ok).toBe(false);
  });

  it("falls back to a Range GET when HEAD is not OK", async () => {
    let calls = 0;
    const png = pngBytes(800, 600);
    const fakeFetch = (async (_input: string, init?: RequestInit) => {
      calls++;
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "HEAD") return new Response(null, { status: 405 });
      // Range GET
      return new Response(png, {
        status: 206,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;
    const r = await probeImage("https://cdn.example.com/x.png", fakeFetch, allowAnyHost);
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it("rejects http URLs that resolve to SSRF-blocked literals up front", async () => {
    const fakeFetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    // The SSRF guard catches `127.0.0.1` in parseAndValidateUrl — even with a
    // permissive validateHost, the URL-literal check rejects this synchronously.
    const r = await probeImage("http://127.0.0.1/x.png", fakeFetch, allowAnyHost);
    expect(r.ok).toBe(false);
  });
});

describe("readImageDimensions", () => {
  it("reads PNG dimensions", () => {
    const png = pngBytes(800, 600);
    expect(readImageDimensions(png)).toEqual({ width: 800, height: 600 });
  });

  it("reads GIF dimensions", () => {
    const gif = gifBytes(400, 200);
    expect(readImageDimensions(gif)).toEqual({ width: 400, height: 200 });
  });

  it("returns null for unknown formats", () => {
    expect(
      readImageDimensions(
        new Uint8Array([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        ]),
      ),
    ).toBeNull();
  });
});

// --- helpers ---

function pngBytes(width: number, height: number): Uint8Array {
  // Pad to 64 bytes so it clears the probe's 32-byte sanity floor.
  const bytes = new Uint8Array(64);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  bytes[4] = 0x0d;
  bytes[5] = 0x0a;
  bytes[6] = 0x1a;
  bytes[7] = 0x0a;
  // IHDR length/type — values don't matter for the dimension reader.
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes[0] = 0x47; // G
  bytes[1] = 0x49; // I
  bytes[2] = 0x46; // F
  bytes[3] = 0x38; // 8
  bytes[4] = 0x39; // 9
  bytes[5] = 0x61; // a
  bytes[6] = width & 0xff;
  bytes[7] = (width >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (height >>> 8) & 0xff;
  return bytes;
}
