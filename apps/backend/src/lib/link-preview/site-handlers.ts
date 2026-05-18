// Per-site handlers for URLs whose default behavior is broken or thin:
//
// - x.com / twitter.com: returns a JS-only shell to non-logged-in clients
//   since 2023. FxTwitter exposes the same data via a small JSON API
//   (https://docs.fxembed.com/api/introduction) that returns photo URLs and
//   video thumbnails.
//
// - github.com/<owner>/<repo>: the page's `og:image` is fine, but
//   `https://opengraph.githubassets.com/1/<owner>/<repo>` is the actual
//   asset GitHub serves to social-media unfurlers and is more reliable than
//   parsing the HTML (which currently puts the image behind a redirect).
//
// - amazon.{tld}/dp/<asin>: the public page rarely sets a useful og:image —
//   the actual product hero lives at `images-na.ssl-images-amazon.com` and
//   can be addressed by ASIN directly:
//   `https://images-na.ssl-images-amazon.com/images/P/<ASIN>.01.LZZZZZZZ.jpg`
//
// Each handler returns a partial preview (image + title hints) that the
// orchestrator merges over the generic HTML parse. Handlers never throw —
// they return null on any failure so the generic path takes over.

import { logger } from "../logger.js";
import { assertHostnameSafe, SsrfBlockedError } from "../ssrf-guard.js";

const FETCH_TIMEOUT_MS = 2500;
const MAX_BYTES = 200_000;

export interface SiteHandlerResult {
  /** Best image we found via the site-specific path. */
  image: string | null;
  /** Optional title — wins over og:title when present (e.g. FxTwitter author + text). */
  title: string | null;
  /** Optional description override. */
  description: string | null;
  /** Used for analytics / debug. */
  handler: string;
}

type Handler = (url: URL, fetcher: typeof fetch) => Promise<SiteHandlerResult | null>;

const HANDLERS: Array<{ test: (url: URL) => boolean; run: Handler }> = [
  { test: isTwitterUrl, run: fxTwitter },
  { test: isGitHubRepoUrl, run: githubRepo },
  { test: isAmazonProductUrl, run: amazonProduct },
];

export async function runSiteHandler(
  url: URL,
  fetcher: typeof fetch = fetch,
): Promise<SiteHandlerResult | null> {
  for (const h of HANDLERS) {
    if (!h.test(url)) continue;
    try {
      const result = await h.run(url, fetcher);
      if (result?.image || result?.title) return result;
    } catch (error) {
      logger.warn("site-handler failed", { error, url: url.href });
    }
  }
  return null;
}

// --- Twitter / X via FxTwitter ---

function isTwitterUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host !== "twitter.com" && host !== "x.com") return false;
  // /<user>/status/<id> — bail out for anything else (timelines, search…).
  return /^\/[A-Za-z0-9_]{1,15}\/status\/\d{2,20}(?:[/?#]|$)/.test(url.pathname);
}

async function fxTwitter(url: URL, fetcher: typeof fetch): Promise<SiteHandlerResult | null> {
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{2,20})/);
  if (!match) return null;
  const [, _user, id] = match;
  const apiUrl = new URL(`https://api.fxtwitter.com/2/status/${id}`);
  try {
    await assertHostnameSafe(apiUrl.hostname);
  } catch {
    return null;
  }
  const body = await fetchJson(apiUrl, fetcher);
  if (!body || typeof body !== "object") return null;
  const status = (body as { status?: Record<string, unknown> }).status;
  if (!status || typeof status !== "object") return null;

  const media = status.media as
    | {
        photos?: Array<{ url?: string; type?: string }>;
        videos?: Array<{ thumbnail_url?: string }>;
      }
    | undefined;
  const photo = media?.photos?.find((p) => typeof p.url === "string");
  const videoThumb = media?.videos?.find((v) => typeof v.thumbnail_url === "string");
  const image = photo?.url ?? videoThumb?.thumbnail_url ?? null;

  const author = (status.author as { name?: string; screen_name?: string } | undefined) ?? {};
  const authorLabel = author.name ?? (author.screen_name ? `@${author.screen_name}` : null);
  const text = typeof status.text === "string" ? status.text : null;
  const title = authorLabel && text ? `${authorLabel} on X` : authorLabel;
  const description = text ? truncate(text, 280) : null;

  if (!image && !title) return null;
  return { image, title, description, handler: "fxtwitter" };
}

// --- GitHub repo ---

function isGitHubRepoUrl(url: URL): boolean {
  if (url.hostname.toLowerCase() !== "github.com") return false;
  // /<owner>/<repo>  (optionally /tree/<branch>, etc — image still applies)
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (!m) return false;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return false;
  // Filter system paths that aren't repos.
  return ![
    "marketplace",
    "settings",
    "explore",
    "topics",
    "trending",
    "collections",
    "events",
    "sponsors",
    "issues",
    "pulls",
    "notifications",
    "search",
    "login",
    "join",
    "about",
    "pricing",
    "features",
    "site",
  ].includes(owner.toLowerCase());
}

async function githubRepo(url: URL, _fetcher: typeof fetch): Promise<SiteHandlerResult | null> {
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  const owner = m[1];
  const repo = (m[2] ?? "").replace(/\.git$/, "");
  if (!owner || !repo) return null;
  // GitHub generates a per-repo unfurl image at this canonical URL. No
  // need to fetch — return it as a candidate and let the image probe verify.
  return {
    image: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
    title: `${owner}/${repo}`,
    description: null,
    handler: "github-repo",
  };
}

// --- Amazon product ---

const AMAZON_TLD_RE =
  /^(?:www\.|smile\.)?amazon\.(?:com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in)$/i;
const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

function isAmazonProductUrl(url: URL): boolean {
  if (!AMAZON_TLD_RE.test(url.hostname)) return false;
  return ASIN_RE.test(url.pathname);
}

async function amazonProduct(url: URL, _fetcher: typeof fetch): Promise<SiteHandlerResult | null> {
  const m = url.pathname.match(ASIN_RE);
  const asin = m?.[1]?.toUpperCase();
  if (!asin) return null;
  // The `images-na.ssl-images-amazon.com/images/P/<ASIN>.01.LZZZZZZZ.jpg`
  // host serves the largest available product image without auth. It's been
  // the canonical "what social cards use" URL for over a decade.
  return {
    image: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
    title: null,
    description: null,
    handler: "amazon",
  };
}

// --- helpers ---

async function fetchJson(url: URL, fetcher: typeof fetch): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
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
    const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (error) {
    if (error instanceof SsrfBlockedError) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export const __internal = {
  isTwitterUrl,
  isGitHubRepoUrl,
  isAmazonProductUrl,
  fxTwitter,
  githubRepo,
  amazonProduct,
};
