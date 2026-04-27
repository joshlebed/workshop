import { createHash } from "node:crypto";
import type { LinkPreview, LinkPreviewResponse } from "@workshop/shared";
import { Hono } from "hono";
import { z } from "zod";
import { logger } from "../../lib/logger.js";
import { CacheTtl, lookupCacheEntry, upsertCacheEntry } from "../../lib/metadata-cache.js";
import { err, ok } from "../../lib/response.js";
import { assertHostnameSafe, parseAndValidateUrl, SsrfBlockedError } from "../../lib/ssrf-guard.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const linkPreviewRoutes = new Hono();

linkPreviewRoutes.use("*", requireAuth);

const userKey = (c: Parameters<Parameters<typeof linkPreviewRoutes.use>[1]>[0]): string | null =>
  c.get("userId") ?? null;

const querySchema = z.object({
  url: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "url required").max(2048, "url too long")),
});

const FETCH_TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1_000_000; // 1 MB
const USER_AGENT = "WorkshopLinkPreview/1.0 (+https://workshop.pages.dev)";
const CACHE_SOURCE = "link_preview";

/**
 * Stable cache key: sha1 of the normalized URL. Storing the full URL as
 * `source_id` would push variable-length text into the (source, source_id)
 * primary key — a fixed-width hash keeps the index tidy.
 */
function cacheKeyFor(url: URL): string {
  return createHash("sha1").update(url.href).digest("hex");
}

interface FetchedPage {
  finalUrl: URL;
  contentType: string | null;
  body: string;
}

interface DepsForTesting {
  fetchPage?: (url: URL) => Promise<FetchedPage>;
  lookupCache?: <T>(source: string, sourceId: string) => Promise<{ data: T } | null>;
  upsertCache?: (source: string, sourceId: string, data: unknown, ttl: number) => Promise<void>;
}

let testDeps: DepsForTesting = {};
export const __testing = {
  setDeps(d: DepsForTesting) {
    testDeps = d;
  },
  reset() {
    testDeps = {};
  },
};

async function lookup<T>(source: string, sourceId: string): Promise<{ data: T } | null> {
  if (testDeps.lookupCache) return testDeps.lookupCache<T>(source, sourceId);
  const r = await lookupCacheEntry<T>(source, sourceId).catch(() => null);
  return r ? { data: r.data } : null;
}

async function upsert(source: string, sourceId: string, data: unknown, ttl: number): Promise<void> {
  if (testDeps.upsertCache) {
    await testDeps.upsertCache(source, sourceId, data, ttl);
    return;
  }
  await upsertCacheEntry(source, sourceId, data, ttl);
}

/**
 * Fetches `url` with manual redirect handling so the SSRF guard re-runs on
 * every hop. Caps body at 1 MB by reading chunks; aborts as soon as the cap
 * is reached. 3s total timeout, 3 redirects max.
 */
async function fetchPage(url: URL): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertHostnameSafe(current.hostname);
      const res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`redirect with no Location header (status ${res.status})`);
        if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
        const next = new URL(location, current);
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error(`redirect to disallowed protocol: ${next.protocol}`);
        }
        current = next;
        continue;
      }

      if (!res.ok) throw new Error(`upstream ${res.status}`);

      const contentType = res.headers.get("content-type");
      const body = await readCappedBody(res);
      return { finalUrl: current, contentType, body };
    }
    // Loop exits via return / throw; this is unreachable but satisfies the type.
    throw new Error("redirect loop exited unexpectedly");
  } finally {
    clearTimeout(timer);
  }
}

async function readCappedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`response body exceeded ${MAX_BODY_BYTES} bytes`);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Pulls OG / Twitter card / `<title>` data out of the head of an HTML doc.
 * Deliberately not a full HTML parser — link-preview pages put their meta
 * tags in the first ~64 KB of `<head>`, and the chunk cap above already
 * keeps the input small. Tag attribute order varies in the wild, so we
 * extract `name`/`property` and `content` independently from each tag.
 */
function parseOgMeta(html: string): {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
} {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const haystack = headMatch ? headMatch[0] : html;

  const metas = new Map<string, string>();
  const metaRe = /<meta\b([^>]*)>/gi;
  for (const m of haystack.matchAll(metaRe)) {
    const attrs = m[1] ?? "";
    const key = attrText(attrs, "property") ?? attrText(attrs, "name");
    const value = attrText(attrs, "content");
    if (!key || value == null) continue;
    const lower = key.toLowerCase();
    if (!metas.has(lower)) metas.set(lower, value);
  }

  const titleTag = haystack.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const fallbackTitle = titleTag ? decodeEntities(titleTag[1]?.trim() ?? "") : "";

  const title =
    metas.get("og:title") ??
    metas.get("twitter:title") ??
    (fallbackTitle.length ? fallbackTitle : null);
  const description =
    metas.get("og:description") ??
    metas.get("twitter:description") ??
    metas.get("description") ??
    null;
  const image = metas.get("og:image") ?? metas.get("twitter:image") ?? null;
  const siteName = metas.get("og:site_name") ?? metas.get("application-name") ?? null;

  return {
    title: title ? decodeEntities(title) : null,
    description: description ? decodeEntities(description) : null,
    image: image ? decodeEntities(image) : null,
    siteName: siteName ? decodeEntities(siteName) : null,
  };
}

function attrText(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = attrs.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    }
    if (code.startsWith("#")) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    }
    return ENTITY_MAP[code.toLowerCase()] ?? _;
  });
}

function buildPreview(originalUrl: URL, page: FetchedPage): LinkPreview {
  const meta = parseOgMeta(page.body);
  const image = meta.image ? toAbsoluteUrl(meta.image, page.finalUrl) : null;
  return {
    url: originalUrl.href,
    finalUrl: page.finalUrl.href,
    title: meta.title,
    description: meta.description,
    image,
    siteName: meta.siteName ?? page.finalUrl.hostname,
    fetchedAt: new Date().toISOString(),
  };
}

function toAbsoluteUrl(raw: string, base: URL): string | null {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

linkPreviewRoutes.get(
  "/",
  rateLimit({ family: "v1.link-preview", limit: 30, windowSec: 60, key: userKey }),
  async (c) => {
    const queryParsed = querySchema.safeParse({ url: c.req.query("url") ?? "" });
    if (!queryParsed.success) {
      return err(c, "VALIDATION", "invalid query", queryParsed.error.issues);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = parseAndValidateUrl(queryParsed.data.url);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        return err(c, "VALIDATION", error.message);
      }
      throw error;
    }

    const cacheKey = cacheKeyFor(parsedUrl);

    const cached = await lookup<LinkPreview>(CACHE_SOURCE, cacheKey);
    if (cached) {
      const response: LinkPreviewResponse = { preview: cached.data };
      return ok(c, response);
    }

    let page: FetchedPage;
    try {
      page = await (testDeps.fetchPage ?? fetchPage)(parsedUrl);
    } catch (error) {
      if (error instanceof SsrfBlockedError) {
        // SSRF blocks at fetch time (e.g. redirect to a private IP) are
        // user-actionable — surface as 400 like the up-front validation.
        return err(c, "VALIDATION", error.message);
      }
      logger.warn("link-preview fetch failed", { error, url: parsedUrl.href });
      return err(c, "INTERNAL", "could not fetch preview");
    }

    const preview = buildPreview(parsedUrl, page);

    upsert(CACHE_SOURCE, cacheKey, preview, CacheTtl.linkPreview).catch((error) => {
      logger.warn("metadata cache write failed", { error, source: CACHE_SOURCE });
    });

    const response: LinkPreviewResponse = { preview };
    return ok(c, response);
  },
);

export const __internal = {
  parseOgMeta,
  cacheKeyFor,
  buildPreview,
};
