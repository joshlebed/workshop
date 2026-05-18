// Image-side helpers used by the link-preview orchestrator:
//
// - `probeImage`: confirm a candidate is reachable, has an `image/*`
//   content-type, and meets a minimum byte size. We only spend a probe on
//   candidates whose dimensions weren't pre-declared by markup. The probe is
//   `HEAD` first; if the upstream returns 4xx/405 (common on tightly tuned
//   image hosts) we retry with a Range `0-2047` GET which decodes the magic
//   bytes for the dimensions and bails after 2 KB.
//
// - `buildProxyUrl`: wrap an upstream image URL in a wsrv.nl proxy URL so
//   the client gets resize + format negotiation + always-available delivery.
//   wsrv.nl is operated by jbroadway and has been used by Mastodon /
//   Discourse / Bun docs for years; it caches aggressively and degrades
//   gracefully (CORS-friendly, supports range requests).

import { assertHostnameSafe, parseAndValidateUrl, SsrfBlockedError } from "../ssrf-guard.js";

const PROBE_TIMEOUT_MS = 2000;
// Smaller than the HTML cap — we just need magic bytes + dimensions.
const PROBE_MAX_BYTES = 4096;

interface ProbeResult {
  ok: boolean;
  contentType: string | null;
  byteLength: number | null;
  /** When non-null, the upstream returned dimensions or we decoded them. */
  width: number | null;
  height: number | null;
}

/**
 * `HEAD` the URL first. If the server rejects HEAD (common on image hosts
 * tuned for hot caching) fall back to a Range GET capped at PROBE_MAX_BYTES.
 * Returns ok=true only when we got an `image/*` content-type and at least a
 * few hundred bytes of body — enough to rule out 1×1 trackers without an
 * `og:image:width` declaration.
 *
 * `validateHost` is overridable so tests can inject a no-op; production
 * always uses the SSRF-guarding default. The probe also re-runs URL parse
 * validation up front so a candidate that looks fine to the HTML parser
 * but fails SSRF (e.g. a redirect into RFC1918) gets rejected here.
 */
export async function probeImage(
  url: string,
  fetcher: typeof fetch = fetch,
  validateHost: (hostname: string) => Promise<void> = assertHostnameSafe,
): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = parseAndValidateUrl(url);
  } catch (e) {
    if (e instanceof SsrfBlockedError) return failResult();
    throw e;
  }
  try {
    await validateHost(parsed.hostname);
  } catch {
    return failResult();
  }
  // HEAD
  const head = await tryFetch(parsed, "HEAD", null, fetcher);
  if (head?.ok && isImageType(head.contentType)) {
    const length = parseContentLength(head.contentLength);
    return {
      ok: length === null || length > 256,
      contentType: head.contentType,
      byteLength: length,
      width: null,
      height: null,
    };
  }
  // Range GET fallback
  const partial = await tryFetch(parsed, "GET", `bytes=0-${PROBE_MAX_BYTES - 1}`, fetcher);
  if (!partial) return failResult();
  if (!partial.ok) return failResult();
  if (!isImageType(partial.contentType)) return failResult();
  const bytes = partial.bytes;
  if (!bytes || bytes.byteLength < 32) return failResult();
  const dims = readImageDimensions(bytes);
  return {
    ok: true,
    contentType: partial.contentType,
    byteLength: bytes.byteLength,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

interface FetchOutcome {
  ok: boolean;
  contentType: string | null;
  contentLength: string | null;
  bytes: Uint8Array | null;
}

async function tryFetch(
  url: URL,
  method: "HEAD" | "GET",
  range: string | null,
  fetcher: typeof fetch,
): Promise<FetchOutcome | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "image/*" };
    if (range) headers.Range = range;
    const res = await fetcher(url.toString(), { method, headers, signal: controller.signal });
    const contentType = res.headers.get("content-type");
    const contentLength = res.headers.get("content-length");
    if (method === "HEAD") {
      return { ok: res.ok, contentType, contentLength, bytes: null };
    }
    if (!res.ok && res.status !== 206) {
      return { ok: false, contentType, contentLength, bytes: null };
    }
    const reader = res.body?.getReader();
    if (!reader) return { ok: res.ok, contentType, contentLength, bytes: null };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= PROBE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { ok: true, contentType, contentLength, bytes: merged };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function failResult(): ProbeResult {
  return { ok: false, contentType: null, byteLength: null, width: null, height: null };
}

function isImageType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  if (!lower.startsWith("image/")) return false;
  // Reject SVG only when explicitly requested? Keep it — Mastodon allows SVG.
  return true;
}

function parseContentLength(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Reads PNG / JPEG / GIF / WebP magic bytes and returns dimensions. Returns
 * null on unknown formats — the caller treats null as "couldn't determine"
 * (not a failure).
 */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A | 8 byte length+type | IHDR (4) | width (4 BE) | height (4 BE)
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return { width, height };
  }
  // GIF: GIF87a / GIF89a + width(2 LE) + height(2 LE)
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    const width = readU16LE(bytes, 6);
    const height = readU16LE(bytes, 8);
    return { width, height };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const fourCc = String.fromCharCode(
      bytes[12] ?? 0,
      bytes[13] ?? 0,
      bytes[14] ?? 0,
      bytes[15] ?? 0,
    );
    if (fourCc === "VP8 " && bytes.length >= 30) {
      const width = readU16LE(bytes, 26) & 0x3fff;
      const height = readU16LE(bytes, 28) & 0x3fff;
      return { width, height };
    }
    if (fourCc === "VP8L" && bytes.length >= 25) {
      const b0 = bytes[21] ?? 0;
      const b1 = bytes[22] ?? 0;
      const b2 = bytes[23] ?? 0;
      const b3 = bytes[24] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (fourCc === "VP8X" && bytes.length >= 30) {
      const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
      const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
      return { width, height };
    }
  }
  // JPEG: 0xFF 0xD8 ... walk SOF markers
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      // SOF0..SOF15 (except DHT 0xC4, DAC 0xCC, DNL 0xCC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const height = readU16BE(bytes, i + 5);
        const width = readU16BE(bytes, i + 7);
        return { width, height };
      }
      const segLen = readU16BE(bytes, i + 2);
      if (segLen < 2) return null;
      i += 2 + segLen;
    }
    return null;
  }
  return null;
}

function readU32BE(b: Uint8Array, off: number): number {
  return (
    ((b[off] ?? 0) << 24) | ((b[off + 1] ?? 0) << 16) | ((b[off + 2] ?? 0) << 8) | (b[off + 3] ?? 0)
  );
}
function readU16BE(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) << 8) | (b[off + 1] ?? 0);
}
function readU16LE(b: Uint8Array, off: number): number {
  return (b[off] ?? 0) | ((b[off + 1] ?? 0) << 8);
}

// --- wsrv.nl proxy ---

const PROXY_BASE = "https://wsrv.nl/";
// 600 keeps a 2x retina render at our 52pt tile and stays inside wsrv's
// no-API-key limits. Output webp is the smallest format wsrv supports on a
// per-request basis and every modern browser/RN-image renderer reads it.
const PROXY_PARAMS = "w=600&h=600&fit=cover&we&output=webp&n=-1";

/**
 * Wraps `image` in a wsrv.nl URL. Returns null for inputs we can't safely
 * proxy (data: URLs, non-http schemes, or anything that fails URL parsing).
 * Idempotent — passing an already-wrapped wsrv URL just rebuilds it from
 * the inner `url=` parameter so we don't double-encode.
 */
export function buildProxyUrl(image: string | null): string | null {
  if (!image) return null;
  let u: URL;
  try {
    u = new URL(image);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.hostname.toLowerCase() === "wsrv.nl") {
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    return `${PROXY_BASE}?url=${encodeURIComponent(inner)}&${PROXY_PARAMS}`;
  }
  return `${PROXY_BASE}?url=${encodeURIComponent(u.href)}&${PROXY_PARAMS}`;
}

// --- favicon last-resort fallback (Google s2 favicons) ---

/**
 * Builds a Google-hosted favicon URL that always returns *something* (the
 * generic globe glyph for hosts Google doesn't know). Used when the page
 * advertised no apple-touch-icon and no usable `<link rel="icon">`.
 */
export function googleFaviconUrl(host: string): string {
  const cleaned = host.replace(/^[\s.]+|[\s.]+$/g, "");
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleaned)}&sz=128`;
}
