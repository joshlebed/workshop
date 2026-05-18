// oEmbed lookup. Two paths:
//
// 1. Static provider table — covers the ~15 hosts that produce 90%+ of pasted
//    URLs (YouTube, Vimeo, Spotify, SoundCloud, Reddit, Bandcamp, etc.). Their
//    oEmbed endpoint always returns a `thumbnail_url` that's usually higher
//    quality than the page's `og:image`.
//
// 2. Discovery via `<link rel="alternate" type="application/json+oembed">` —
//    every WordPress site advertises one and most CMSes follow suit. Used when
//    the URL isn't in the static table but the HTML response includes a hint.
//
// The route calls `fetchOembed(url)` early; if it returns a result, we still
// fetch the HTML (for OG description / favicon / fallback metadata) but the
// oEmbed `thumbnail_url` jumps to the top of the image-candidate list.
//
// References:
// - https://oembed.com/ (registry + discovery spec)
// - Mastodon: app/services/fetch_oembed_service.rb (same two-tier strategy)

import { z } from "zod";
import { assertHostnameSafe, parseAndValidateUrl, SsrfBlockedError } from "../ssrf-guard.js";

const FETCH_TIMEOUT_MS = 2500;
const MAX_RESPONSE_BYTES = 200_000;

interface Provider {
  hosts: RegExp;
  endpoint: string;
}

// Static table: hostname → oEmbed JSON endpoint. Order doesn't matter; only
// the first match wins. Endpoints all use the `?url=` parameter per spec.
const PROVIDERS: readonly Provider[] = [
  // Video
  {
    hosts: /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i,
    endpoint: "https://www.youtube.com/oembed",
  },
  {
    hosts: /^(?:player\.|www\.)?vimeo\.com$/i,
    endpoint: "https://vimeo.com/api/oembed.json",
  },
  {
    hosts: /^(?:www\.)?dailymotion\.com$/i,
    endpoint: "https://www.dailymotion.com/services/oembed",
  },
  {
    hosts: /^(?:www\.)?tiktok\.com$/i,
    endpoint: "https://www.tiktok.com/oembed",
  },
  {
    hosts: /^(?:www\.)?loom\.com$/i,
    endpoint: "https://www.loom.com/v1/oembed",
  },
  // Audio
  {
    hosts: /^open\.spotify\.com$/i,
    endpoint: "https://open.spotify.com/oembed",
  },
  {
    hosts: /^(?:www\.)?soundcloud\.com$/i,
    endpoint: "https://soundcloud.com/oembed",
  },
  {
    hosts: /^(?:www\.)?mixcloud\.com$/i,
    endpoint: "https://www.mixcloud.com/oembed/",
  },
  {
    hosts: /^(?:.+\.)?bandcamp\.com$/i,
    endpoint: "https://bandcamp.com/oembed",
  },
  // Social
  {
    hosts: /^(?:www\.)?reddit\.com$/i,
    endpoint: "https://www.reddit.com/oembed",
  },
  {
    hosts: /^(?:www\.)?flickr\.com$/i,
    endpoint: "https://www.flickr.com/services/oembed/?format=json",
  },
  // Creative
  {
    hosts: /^(?:www\.)?codepen\.io$/i,
    endpoint: "https://codepen.io/api/oembed",
  },
  {
    hosts: /^(?:www\.)?figma\.com$/i,
    endpoint: "https://www.figma.com/api/oembed",
  },
  {
    hosts: /^(?:www\.)?giphy\.com$/i,
    endpoint: "https://giphy.com/services/oembed",
  },
  {
    hosts: /^podcasts\.apple\.com$/i,
    endpoint: "https://podcasts.apple.com/api/oembed",
  },
];

const oembedResponseSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().nullish(),
    author_name: z.string().nullish(),
    provider_name: z.string().nullish(),
    thumbnail_url: z.string().nullish(),
    thumbnail_width: z.number().nullish(),
    thumbnail_height: z.number().nullish(),
    html: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
  })
  .passthrough();

export interface OembedResult {
  thumbnailUrl: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  title: string | null;
  authorName: string | null;
  providerName: string | null;
}

/** Resolve the oEmbed endpoint for a target URL — table first, then null. */
export function lookupProviderEndpoint(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  for (const p of PROVIDERS) {
    if (p.hosts.test(host)) return p.endpoint;
  }
  return null;
}

/**
 * Walks an HTML head for a `<link rel="alternate" type="application/json+oembed">`
 * (or `text/xml+oembed`, ignored — we only consume JSON). Returns the
 * discovered endpoint URL, or null.
 */
export function discoverOembedEndpoint(html: string): string | null {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const haystack = headMatch ? headMatch[0] : html;
  for (const m of haystack.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1] ?? "";
    const rel = attrText(attrs, "rel")?.toLowerCase();
    const type = attrText(attrs, "type")?.toLowerCase();
    if (rel !== "alternate") continue;
    if (type !== "application/json+oembed") continue;
    const href = attrText(attrs, "href");
    if (href) return href;
  }
  return null;
}

function attrText(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = attrs.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/**
 * Fetches the oEmbed JSON for a discovered or registry endpoint. Goes through
 * the SSRF guard. Body is capped at 200 KB — oEmbed responses are tiny
 * (a few hundred bytes) and any provider returning more is misbehaving.
 *
 * `validateHost` is overridable so tests can inject a no-op; production
 * always uses the real SSRF-guarding default.
 */
export async function fetchOembed(
  targetUrl: URL,
  fetcher: typeof fetch = fetch,
  validateHost: (hostname: string) => Promise<void> = assertHostnameSafe,
): Promise<OembedResult | null> {
  const endpoint = lookupProviderEndpoint(targetUrl);
  if (!endpoint) return null;
  return await callOembedEndpoint(endpoint, targetUrl, fetcher, validateHost);
}

export async function fetchOembedDiscovered(
  endpoint: string,
  targetUrl: URL,
  fetcher: typeof fetch = fetch,
  validateHost: (hostname: string) => Promise<void> = assertHostnameSafe,
): Promise<OembedResult | null> {
  return await callOembedEndpoint(endpoint, targetUrl, fetcher, validateHost);
}

async function callOembedEndpoint(
  endpoint: string,
  targetUrl: URL,
  fetcher: typeof fetch,
  validateHost: (hostname: string) => Promise<void>,
): Promise<OembedResult | null> {
  let endpointUrl: URL;
  try {
    endpointUrl = parseAndValidateUrl(endpoint);
  } catch (e) {
    if (e instanceof SsrfBlockedError) return null;
    throw e;
  }
  endpointUrl.searchParams.set("url", targetUrl.href);
  if (!endpointUrl.searchParams.has("format")) {
    endpointUrl.searchParams.set("format", "json");
  }
  try {
    await validateHost(endpointUrl.hostname);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(endpointUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await readCapped(res);
    if (!body) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    const schemaResult = oembedResponseSchema.safeParse(parsed);
    if (!schemaResult.success) return null;
    const data = schemaResult.data;
    return {
      thumbnailUrl: data.thumbnail_url ?? null,
      thumbnailWidth: typeof data.thumbnail_width === "number" ? data.thumbnail_width : null,
      thumbnailHeight: typeof data.thumbnail_height === "number" ? data.thumbnail_height : null,
      title: data.title ?? null,
      authorName: data.author_name ?? null,
      providerName: data.provider_name ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export const __internal = { attrText };
