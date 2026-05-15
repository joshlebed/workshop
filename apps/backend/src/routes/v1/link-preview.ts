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
  const image = pickImage(collectImageCandidates(page.body), page.finalUrl);
  const favicon = pickFavicon(collectFaviconCandidates(page.body), page.finalUrl);
  return {
    url: originalUrl.href,
    finalUrl: page.finalUrl.href,
    title: meta.title,
    description: meta.description,
    image,
    favicon,
    siteName: meta.siteName ?? page.finalUrl.hostname,
    fetchedAt: new Date().toISOString(),
  };
}

// Anything smaller than this in either dimension is too small to use as a
// game tile — clients fall back to a placeholder glyph instead.
const MIN_IMAGE_DIMENSION = 200;
// Smaller bar for favicons since 180×180 apple-touch-icons are common and
// still look fine on a 64pt tile. Standard 16/32 px `.ico` files don't clear it.
const MIN_FAVICON_DIMENSION = 64;
// Substrings that almost always mark a tracking pixel, spacer, or placeholder.
// Word-boundary matches keep `300x250-banner.jpg` (a real banner) from tripping.
const LOW_QUALITY_URL_RE =
  /\b(?:1x1|2x2|pixel|spacer|blank|transparent|beacon|tracker|tracking)\b/i;

interface ImageCandidate {
  url: string;
  width: number | null;
  height: number | null;
}

/**
 * Walks the parsed head + body for every image URL the page advertises. Order
 * matters — earlier sources are tried first by `pickImage`. We deliberately
 * over-collect (e.g. every JSON-LD `image` we can reach) and lean on the
 * quality filter to drop bad candidates rather than guessing which one is
 * canonical from markup alone.
 */
function collectImageCandidates(html: string): ImageCandidate[] {
  const head = extractHead(html);
  const metas = collectMetas(head);
  const out: ImageCandidate[] = [];

  // OG width/height are global — they describe og:image only.
  const ogW = parseDimension(metas.get("og:image:width"));
  const ogH = parseDimension(metas.get("og:image:height"));
  pushCandidate(
    out,
    metas.get("og:image:secure_url") ?? metas.get("og:image:url") ?? metas.get("og:image"),
    ogW,
    ogH,
  );

  pushCandidate(out, metas.get("twitter:image") ?? metas.get("twitter:image:src"), null, null);

  for (const c of collectJsonLdImages(html)) out.push(c);

  pushCandidate(out, metas.get("msapplication-tileimage"), null, null);
  pushCandidate(out, parseItempropImage(head), null, null);
  pushCandidate(out, parseImageSrcLink(head), null, null);

  return out;
}

function pushCandidate(
  out: ImageCandidate[],
  url: string | null | undefined,
  width: number | null,
  height: number | null,
): void {
  if (!url) return;
  out.push({ url: decodeEntities(url), width, height });
}

function extractHead(html: string): string {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  return headMatch ? headMatch[0] : html;
}

function collectMetas(head: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const key = attrText(attrs, "property") ?? attrText(attrs, "name");
    const value = attrText(attrs, "content");
    if (!key || value == null) continue;
    const lower = key.toLowerCase();
    if (!metas.has(lower)) metas.set(lower, value);
  }
  return metas;
}

function parseDimension(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseItempropImage(head: string): string | null {
  const m = head.match(/<meta\b[^>]*\bitemprop\s*=\s*["']image["'][^>]*>/i);
  return m ? attrText(m[0], "content") : null;
}

function parseImageSrcLink(head: string): string | null {
  const m = head.match(/<link\b[^>]*\brel\s*=\s*["']image_src["'][^>]*>/i);
  return m ? attrText(m[0], "href") : null;
}

/**
 * JSON-LD blocks can be a single object, an array, or have an `@graph` with
 * mixed types. `image` itself can be a string, an `ImageObject`, or an array
 * of either. We recurse to a small depth so a hostile or pathological doc
 * can't blow the stack.
 */
function collectJsonLdImages(html: string): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    walkJsonLdImages(parsed, out, 0);
  }
  return out;
}

function walkJsonLdImages(node: unknown, out: ImageCandidate[], depth: number): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLdImages(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj["@graph"]) walkJsonLdImages(obj["@graph"], out, depth + 1);
  const image = obj.image;
  if (image == null) return;
  if (typeof image === "string") {
    out.push({ url: image, width: null, height: null });
    return;
  }
  if (Array.isArray(image)) {
    for (const item of image) walkJsonLdImages({ image: item }, out, depth + 1);
    return;
  }
  if (typeof image === "object") {
    const child = image as Record<string, unknown>;
    const url = child.url;
    if (typeof url === "string") {
      out.push({
        url,
        width: coerceNumber(child.width),
        height: coerceNumber(child.height),
      });
    }
  }
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") return parseDimension(v);
  return null;
}

function pickImage(candidates: ImageCandidate[], base: URL): string | null {
  for (const c of candidates) {
    if (isLowQualityImage(c)) continue;
    const abs = toAbsoluteUrl(c.url, base);
    if (abs) return abs;
  }
  return null;
}

function isLowQualityImage(c: ImageCandidate): boolean {
  const url = c.url.trim();
  if (!url) return true;
  // Base64 placeholders are almost always trackers; allow inline SVG, which
  // can be a legitimate scalable icon.
  if (url.startsWith("data:") && !url.startsWith("data:image/svg")) return true;
  if (LOW_QUALITY_URL_RE.test(url)) return true;
  if (c.width !== null && c.width < MIN_IMAGE_DIMENSION) return true;
  if (c.height !== null && c.height < MIN_IMAGE_DIMENSION) return true;
  return false;
}

interface FaviconCandidate {
  url: string;
  rel: string;
  size: number | null;
}

function collectFaviconCandidates(html: string): FaviconCandidate[] {
  const head = extractHead(html);
  const out: FaviconCandidate[] = [];
  for (const m of head.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const rel = attrText(attrs, "rel")?.toLowerCase();
    const href = attrText(attrs, "href");
    if (!rel || !href) continue;
    if (
      rel !== "apple-touch-icon" &&
      rel !== "apple-touch-icon-precomposed" &&
      rel !== "icon" &&
      rel !== "shortcut icon"
    ) {
      continue;
    }
    out.push({ url: decodeEntities(href), rel, size: parseLargestSize(attrText(attrs, "sizes")) });
  }
  return out;
}

function parseLargestSize(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (raw.toLowerCase().includes("any")) return Number.POSITIVE_INFINITY;
  let best: number | null = null;
  for (const token of raw.split(/\s+/)) {
    const m = token.match(/^(\d+)x(\d+)$/i);
    if (!m) continue;
    const max = Math.max(Number.parseInt(m[1] ?? "0", 10), Number.parseInt(m[2] ?? "0", 10));
    if (Number.isFinite(max) && (best == null || max > best)) best = max;
  }
  return best;
}

/**
 * Quality bar for favicons: apple-touch-icons are 180×180 by convention so
 * we accept them without a size attr; any other rel must declare a `sizes`
 * attribute ≥ MIN_FAVICON_DIMENSION (or be an SVG, which scales). We never
 * synthesize `/favicon.ico` — the game tile's 🎮 placeholder beats a 16px
 * postage-stamp icon.
 */
function pickFavicon(candidates: FaviconCandidate[], base: URL): string | null {
  let best: { c: FaviconCandidate; rank: number; size: number } | null = null;
  for (const c of candidates) {
    const isApple = c.rel === "apple-touch-icon" || c.rel === "apple-touch-icon-precomposed";
    const isSvg = /\.svg(?:$|[?#])/i.test(c.url);
    const effective = c.size ?? (isApple ? 180 : isSvg ? Number.POSITIVE_INFINITY : 0);
    if (!isApple && !isSvg && effective < MIN_FAVICON_DIMENSION) continue;
    const rank = isApple ? 3 : c.rel === "icon" ? 2 : 1;
    if (!best || rank > best.rank || (rank === best.rank && effective > best.size)) {
      best = { c, rank, size: effective };
    }
  }
  return best ? toAbsoluteUrl(best.c.url, base) : null;
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
  collectImageCandidates,
  pickImage,
  isLowQualityImage,
  collectFaviconCandidates,
  pickFavicon,
};
