import { createHash } from "node:crypto";
import type { LinkPreview, LinkPreviewResponse } from "@workshop/shared";
import { Hono } from "hono";
import { z } from "zod";
import {
  buildProxyUrl,
  googleFaviconUrl,
  probeImage,
} from "../../lib/link-preview/image-validation.js";
import {
  discoverOembedEndpoint,
  fetchOembed,
  fetchOembedDiscovered,
  type OembedResult,
} from "../../lib/link-preview/oembed.js";
import { runSiteHandler, type SiteHandlerResult } from "../../lib/link-preview/site-handlers.js";
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

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
// 3 MB cap. YouTube's `/watch` HTML weighs ~1.5–2 MB once you include the
// inlined player config; 1 MB was clipping it before the OG tags landed.
// Modern social-card pages can be heavy — Reddit, Medium, news sites all
// run 1–2 MB. Lambda has the memory for it and parsing is bounded by the
// `<head>` regex anyway.
const MAX_BODY_BYTES = 3_000_000;

// User-Agent + headers shaped like Facebook's link-preview bot. Most sites
// keep an allowlist for `facebookexternalhit` because they want their
// previews to look right on Facebook / iMessage / Slack / Discord — all of
// which key their fetching on this exact string. The +URL is intentional so
// site owners who block us can find docs.
//
// See https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/
// and https://deviceandbrowserinfo.com/learning_zone/articles/facebookexternalhit
const USER_AGENT =
  "facebookexternalhit/1.1 (+https://workshop.pages.dev/bot; +https://www.facebook.com/externalhit_uatext.php)";
const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

// `_v3` because the response shape changed (added imageProxy + source).
// Old `link_preview` rows expire over their 7-day TTL.
const CACHE_SOURCE = "link_preview_v3";

const MIN_IMAGE_DIMENSION = 200;
const MIN_FAVICON_DIMENSION = 64;
// Substrings that almost always mark a tracking pixel / spacer / placeholder.
const LOW_QUALITY_URL_RE =
  /\b(?:1x1|2x2|pixel|spacer|blank|transparent|beacon|tracker|tracking)\b/i;

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
  fetchOembedFn?: (url: URL) => Promise<OembedResult | null>;
  fetchOembedDiscoveredFn?: (endpoint: string, url: URL) => Promise<OembedResult | null>;
  runSiteHandlerFn?: (url: URL) => Promise<SiteHandlerResult | null>;
  probeImageFn?: (url: string) => Promise<{ ok: boolean }>;
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
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": ACCEPT_LANGUAGE,
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

interface ImageCandidate {
  url: string;
  width: number | null;
  height: number | null;
  /** Higher = preferred. oEmbed/site-handler beat generic OG. */
  rank: number;
}

const RANK_SITE_HANDLER = 100;
const RANK_OEMBED = 90;
const RANK_OG = 80;
const RANK_TWITTER = 70;
const RANK_JSON_LD = 60;
const RANK_LEGACY = 40;

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
    RANK_OG,
  );

  pushCandidate(
    out,
    metas.get("twitter:image") ?? metas.get("twitter:image:src"),
    null,
    null,
    RANK_TWITTER,
  );

  for (const c of collectJsonLdImages(html)) out.push({ ...c, rank: RANK_JSON_LD });

  pushCandidate(out, metas.get("msapplication-tileimage"), null, null, RANK_LEGACY);
  pushCandidate(out, parseItempropImage(head), null, null, RANK_LEGACY);
  pushCandidate(out, parseImageSrcLink(head), null, null, RANK_LEGACY);

  return out;
}

function pushCandidate(
  out: ImageCandidate[],
  url: string | null | undefined,
  width: number | null,
  height: number | null,
  rank: number,
): void {
  if (!url) return;
  out.push({ url: decodeEntities(url), width, height, rank });
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
function collectJsonLdImages(
  html: string,
): Array<{ url: string; width: number | null; height: number | null }> {
  const out: Array<{ url: string; width: number | null; height: number | null }> = [];
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

function walkJsonLdImages(
  node: unknown,
  out: Array<{ url: string; width: number | null; height: number | null }>,
  depth: number,
): void {
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

function isLowQualityImage(c: {
  url: string;
  width: number | null;
  height: number | null;
}): boolean {
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

function toAbsoluteUrl(raw: string, base: URL): string | null {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

/**
 * Walks candidates in rank-then-order priority, normalizes them to absolute
 * URLs, drops the obvious junk, then probes the rest with a HEAD/Range
 * request. Returns the first that comes back as a real reachable image.
 *
 * Candidates whose dimensions were declared in markup and meet the minimum
 * skip the probe — the markup is already trustworthy enough and probing
 * adds 100–500ms per check.
 */
async function pickValidatedImage(
  candidates: ImageCandidate[],
  base: URL,
  probe: (url: string) => Promise<{ ok: boolean }>,
): Promise<string | null> {
  const ranked = [...candidates].sort((a, b) => b.rank - a.rank);
  const tried = new Set<string>();
  for (const c of ranked) {
    if (isLowQualityImage(c)) continue;
    const abs = toAbsoluteUrl(c.url, base);
    if (!abs) continue;
    if (tried.has(abs)) continue;
    tried.add(abs);

    const dimsKnown =
      c.width !== null &&
      c.height !== null &&
      c.width >= MIN_IMAGE_DIMENSION &&
      c.height >= MIN_IMAGE_DIMENSION;
    if (dimsKnown) return abs;

    const probed = await probe(abs).catch(() => ({ ok: false }));
    if (probed.ok) return abs;
  }
  return null;
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
 * attribute ≥ MIN_FAVICON_DIMENSION (or be an SVG, which scales).
 *
 * Falls back to Google's s2 favicon service when nothing on the page clears
 * the bar — that endpoint always returns a 128px raster (the generic globe
 * for unknown hosts) and is the same fallback iMessage and Slack use.
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
  if (best) return toAbsoluteUrl(best.c.url, base);
  return googleFaviconUrl(base.hostname);
}

/**
 * The core orchestrator. Calls site-handlers + oEmbed in parallel with the
 * HTML fetch, then merges signals to build the final LinkPreview.
 *
 * Order of preference for `image`:
 *   1. site-handler (FxTwitter / GitHub repo / Amazon ASIN)
 *   2. registry oEmbed (YouTube, Vimeo, Spotify, etc.)
 *   3. discovered oEmbed (WordPress, etc.)
 *   4. og:image (and family)
 *   5. twitter:image
 *   6. JSON-LD image / msapp / itemprop / image_src
 *
 * Every candidate either has dimensions ≥ MIN_IMAGE_DIMENSION declared in
 * markup, or is probed (HEAD/Range) to confirm it's a real image. The first
 * to pass becomes `image`; `imageProxy` is the wsrv.nl-wrapped variant the
 * client uses for rendering.
 */
async function buildPreview(
  originalUrl: URL,
  page: FetchedPage,
  oembedRegistry: OembedResult | null,
  siteResult: SiteHandlerResult | null,
  probe: (url: string) => Promise<{ ok: boolean }>,
  fetchOembedDiscoveredFn: (endpoint: string, url: URL) => Promise<OembedResult | null>,
): Promise<LinkPreview> {
  const meta = parseOgMeta(page.body);
  const candidates: ImageCandidate[] = [];

  let oembedDiscovered: OembedResult | null = null;
  if (!oembedRegistry) {
    const endpoint = discoverOembedEndpoint(page.body);
    if (endpoint) {
      const abs = toAbsoluteUrl(endpoint, page.finalUrl);
      if (abs) {
        oembedDiscovered = await fetchOembedDiscoveredFn(abs, page.finalUrl).catch(() => null);
      }
    }
  }
  const oembed = oembedRegistry ?? oembedDiscovered;

  if (siteResult?.image) {
    candidates.push({
      url: siteResult.image,
      width: null,
      height: null,
      rank: RANK_SITE_HANDLER,
    });
  }
  if (oembed?.thumbnailUrl) {
    candidates.push({
      url: oembed.thumbnailUrl,
      width: oembed.thumbnailWidth,
      height: oembed.thumbnailHeight,
      rank: RANK_OEMBED,
    });
  }
  for (const c of collectImageCandidates(page.body)) candidates.push(c);

  const image = await pickValidatedImage(candidates, page.finalUrl, probe);
  const favicon = pickFavicon(collectFaviconCandidates(page.body), page.finalUrl);

  const source: LinkPreview["source"] = siteResult?.image
    ? "site"
    : oembed?.thumbnailUrl
      ? "oembed"
      : "html";

  return {
    url: originalUrl.href,
    finalUrl: page.finalUrl.href,
    title: siteResult?.title ?? meta.title ?? oembed?.title ?? null,
    description: siteResult?.description ?? meta.description ?? null,
    image,
    imageProxy: buildProxyUrl(image),
    favicon,
    siteName:
      meta.siteName ?? oembed?.providerName ?? siteResult?.handler ?? page.finalUrl.hostname,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Site-handler-only build path. Used when the HTML fetch fails but we still
 * got a useful answer from a site-specific handler (e.g. FxTwitter for an
 * x.com URL that returned 401 to our bot).
 */
/**
 * Build a preview from just the side-channel signals (site-handler + oEmbed)
 * — used when the HTML fetch fails (page exceeded the body cap, returned 4xx
 * to our bot, network error, etc.). At least one of the two must have an
 * image or a title; if both are empty the caller falls through to 500.
 */
function buildPreviewFromHints(
  originalUrl: URL,
  siteResult: SiteHandlerResult | null,
  oembedResult: OembedResult | null,
): LinkPreview {
  const image = siteResult?.image ?? oembedResult?.thumbnailUrl ?? null;
  const title = siteResult?.title ?? oembedResult?.title ?? null;
  return {
    url: originalUrl.href,
    finalUrl: originalUrl.href,
    title,
    description: siteResult?.description ?? null,
    image,
    imageProxy: buildProxyUrl(image),
    favicon: googleFaviconUrl(originalUrl.hostname),
    siteName: oembedResult?.providerName ?? originalUrl.hostname,
    source: siteResult?.image ? "site" : "oembed",
    fetchedAt: new Date().toISOString(),
  };
}

export async function resolveLinkPreview(parsedUrl: URL): Promise<LinkPreview> {
  const cacheKey = cacheKeyFor(parsedUrl);

  const cached = await lookup<LinkPreview>(CACHE_SOURCE, cacheKey);
  if (cached) return cached.data;

  // Run the page fetch, site-handler, and registry oEmbed in parallel.
  // Site-handler + oEmbed are stateless lookups and the dominant latency
  // is the page fetch (~1–3s), so doing them concurrently is free.
  const pagePromise = (testDeps.fetchPage ?? fetchPage)(parsedUrl).catch(
    (e: unknown) => e as Error,
  );
  const sitePromise = (testDeps.runSiteHandlerFn ?? runSiteHandler)(parsedUrl).catch(() => null);
  const oembedPromise = (testDeps.fetchOembedFn ?? fetchOembed)(parsedUrl).catch(() => null);

  const [pageOrError, siteResult, oembedResult] = await Promise.all([
    pagePromise,
    sitePromise,
    oembedPromise,
  ]);

  if (pageOrError instanceof Error) {
    if (pageOrError instanceof SsrfBlockedError) throw pageOrError;
    // Last resort: if either the site handler or registry oEmbed got us
    // *something*, use that. Most YouTube/Twitter URLs end up here when
    // the HTML body exceeds the cap — oEmbed already has what we need.
    if (
      siteResult?.image ||
      siteResult?.title ||
      oembedResult?.thumbnailUrl ||
      oembedResult?.title
    ) {
      const preview = buildPreviewFromHints(parsedUrl, siteResult, oembedResult);
      upsert(CACHE_SOURCE, cacheKey, preview, CacheTtl.linkPreview).catch((error) => {
        logger.warn("metadata cache write failed", { error, source: CACHE_SOURCE });
      });
      return preview;
    }
    logger.warn("link-preview fetch failed", { error: pageOrError, url: parsedUrl.href });
    throw pageOrError;
  }

  const probe = testDeps.probeImageFn ?? probeImage;
  const fetchOembedDiscoveredFn = testDeps.fetchOembedDiscoveredFn ?? fetchOembedDiscovered;
  const preview = await buildPreview(
    parsedUrl,
    pageOrError,
    oembedResult,
    siteResult,
    probe,
    fetchOembedDiscoveredFn,
  );

  upsert(CACHE_SOURCE, cacheKey, preview, CacheTtl.linkPreview).catch((error) => {
    logger.warn("metadata cache write failed", { error, source: CACHE_SOURCE });
  });

  return preview;
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

    let preview: LinkPreview;
    try {
      preview = await resolveLinkPreview(parsedUrl);
    } catch (error) {
      if (error instanceof SsrfBlockedError) return err(c, "VALIDATION", error.message);
      return err(c, "INTERNAL", "could not fetch preview");
    }

    const response: LinkPreviewResponse = { preview };
    return ok(c, response);
  },
);

export const __internal = {
  parseOgMeta,
  cacheKeyFor,
  buildPreview,
  buildPreviewFromHints,
  collectImageCandidates,
  pickValidatedImage,
  isLowQualityImage,
  collectFaviconCandidates,
  pickFavicon,
};
