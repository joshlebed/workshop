#!/usr/bin/env node
/**
 * Post-deploy validator for the iMessage / Facebook / Twitter link
 * preview of a share URL. Runs against a live URL (no local stack), so
 * it's the verification step a coding agent or CI workflow can run after
 * the Cloudflare Pages deploy settles to confirm the thumbnail will
 * render correctly on the real platforms.
 *
 * Checks, in order:
 *   1. Fetch the share URL with a Facebook/Apple-LP-shaped user agent
 *      and assert the OG meta tag set is complete + well-formed.
 *   2. Fetch the `og:image` URL and assert: 200, `Content-Type:
 *      image/png`, valid PNG magic bytes, and the dimensions in the
 *      IHDR chunk match what `og:image:width/height` advertised.
 *   3. Assert the route variant and brand match the requested Workshop or
 *      HighScore URL, including one tag per OG/Twitter property.
 *
 * Usage:
 *   node scripts/check-og.mjs [--site=workshop|highscore] <share-url>
 *   node scripts/check-og.mjs https://workshop-a2v.pages.dev/invite/abc123
 *   node scripts/check-og.mjs --site=highscore http://127.0.0.1:8789/g/abc123
 *
 * Exit code 0 on success, 1 on any failure (with a human-readable diff
 * to stderr). Designed to be piped into `gh actions` or pasted into a
 * coding-agent task log.
 */

// User agent string that mirrors what Facebook and Apple LP actually
// send. Apple iMessage's scraper spoofs Facebook + Twitter UAs (see
// research notes in PR description), so a single string covers both.
const SCRAPER_UA =
  "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php) Twitterbot/1.0";

const args = process.argv.slice(2);
const siteOption = args.find((arg) => arg.startsWith("--site="));
const forcedSite = siteOption?.slice("--site=".length);
const url = args.find((arg) => !arg.startsWith("--site="));
if (forcedSite && forcedSite !== "workshop" && forcedSite !== "highscore") {
  console.error(`invalid --site value: ${forcedSite}`);
  process.exit(2);
}
if (!url) {
  console.error("usage: node scripts/check-og.mjs [--site=workshop|highscore] <share-url>");
  process.exit(2);
}

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  console.error(`invalid URL: ${url}`);
  process.exit(2);
}

const isHighScoreHost =
  parsedUrl.hostname === "highscore.live" ||
  parsedUrl.hostname === "highscore.pages.dev" ||
  parsedUrl.hostname.endsWith(".highscore.pages.dev");
const site = forcedSite ?? (isHighScoreHost ? "highscore" : "workshop");
const expectedSiteName = site === "highscore" ? "HighScore" : "Workshop.dev";

const failures = [];
function fail(check, detail) {
  failures.push({ check, detail });
}

/** Extract all <meta property="…" content="…"> + <meta name="…" content="…"> pairs. */
function parseMeta(html) {
  const tags = new Map();
  const counts = new Map();
  const record = (key, value) => {
    const normalizedKey = key.toLowerCase();
    counts.set(normalizedKey, (counts.get(normalizedKey) ?? 0) + 1);
    // Preserve the first value because Facebook's parser is first-wins.
    if (!tags.has(normalizedKey)) tags.set(normalizedKey, value);
  };
  const re = /<meta\s+(?:property|name)=["']([^"']+)["']\s+content=["']([^"']*)["']/gi;
  for (const match of html.matchAll(re)) {
    record(match[1], match[2]);
  }
  // Also handle the reversed attribute order some serializers emit.
  const reReversed = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(reReversed)) {
    record(match[2], match[1]);
  }
  return { tags, counts };
}

/** Read width + height out of a PNG's IHDR chunk. PNG = 8B sig + 4B len + "IHDR" + 4B width + 4B height. */
function readPngDimensions(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  const ihdrTag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrTag !== "IHDR") return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { width, height };
}

console.log(`▶ checking ${url}`);

// 1) Share URL response + meta tags
let html;
try {
  const res = await fetch(url, {
    headers: { "User-Agent": SCRAPER_UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) {
    fail("share-url", `expected 2xx, got ${res.status}`);
  } else {
    html = await res.text();
  }
} catch (e) {
  fail("share-url", `fetch threw: ${e.message ?? e}`);
}

const parsedMeta = html ? parseMeta(html) : { tags: new Map(), counts: new Map() };
const meta = parsedMeta.tags;

const requiredTags = [
  "og:type",
  "og:site_name",
  "og:url",
  "og:title",
  "og:description",
  "og:image",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "description",
];

for (const key of requiredTags) {
  if (!meta.has(key)) {
    fail("missing-meta", key);
  } else if (meta.get(key).trim().length === 0) {
    fail("empty-meta", key);
  }
  if ((parsedMeta.counts.get(key) ?? 0) > 1) {
    fail("duplicate-meta", `${key} appears ${parsedMeta.counts.get(key)} times`);
  }
}

if (meta.get("og:site_name") && meta.get("og:site_name") !== expectedSiteName) {
  fail(
    "wrong-site-name",
    `og:site_name = ${meta.get("og:site_name")} (expected ${expectedSiteName})`,
  );
}

if (meta.get("og:image:type") && meta.get("og:image:type") !== "image/png") {
  fail("wrong-image-type", `og:image:type = ${meta.get("og:image:type")} (expected image/png)`);
}

if (meta.get("twitter:card") && meta.get("twitter:card") !== "summary_large_image") {
  fail("wrong-twitter-card", meta.get("twitter:card"));
}

// Pick the expected variant from the URL path and site:
//   HighScore:
//   - `/g/<token>`                      → game-share card
//   - `/friends/accept/<token>`         → friend card
//   - everything else                  → HighScore default
//   Workshop:
//   - `/l/<slug>` or `/invite/<token>` → list-specific (preview API returned data)
//   - `/list/<uuid>/...`               → list-specific when shareVisibility ∈
//                                         {view, join}; locked "Sign in" copy when
//                                         visibility=off or the preview API failed.
//                                         We accept either since both are valid
//                                         post-redesign outcomes — we just bail on
//                                         the bare brand default, which means the
//                                         middleware didn't fire at all.
//   - `/list/<non-uuid>/...`           → "Sign in to view this list" fallback
//   - `/friends/accept/<token>`        → friend card
//   - `/g/<token>`                     → game-share card
//   - everything else                  → "Workshop.dev" default
//
// A site-name fallback on `/l/...` or `/invite/...` means the API was unreachable
// or the list was deleted and the function silently degraded — that's what
// `fallback-title` was written to catch. The brand default on a URL that legitimately
// maps to it is fine.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ogTitle = meta.get("og:title") ?? "";
const pathname = parsedUrl.pathname;
const listIdMatch = /^\/list\/([^/]+)/.exec(pathname);
const variant = pathname.startsWith("/g/")
  ? "game"
  : pathname.startsWith("/friends/accept/")
    ? "friend"
    : site === "highscore"
      ? "default"
      : pathname.startsWith("/l/") || pathname.startsWith("/invite/")
        ? "list-specific"
        : listIdMatch && UUID_RE.test(listIdMatch[1])
          ? "list-or-locked"
          : pathname.startsWith("/list/")
            ? "locked-list"
            : "default";
if (variant === "list-specific") {
  if (ogTitle === "Workshop.dev" || ogTitle.includes("Sign in") || ogTitle === "") {
    fail(
      "fallback-title",
      `og:title is "${ogTitle}" — the Pages function couldn't fetch list metadata`,
    );
  }
} else if (variant === "list-or-locked") {
  // Either the rich list card (shareVisibility view/join) or the locked-list copy
  // is acceptable. A bare "Workshop.dev" alone means the middleware didn't fire.
  if (ogTitle === "Workshop.dev" || ogTitle === "") {
    fail(
      "list-middleware-missing",
      `og:title is "${ogTitle}" — expected either the list card or the locked-list variant`,
    );
  }
} else if (variant === "locked-list") {
  if (!ogTitle.includes("Sign in") && ogTitle !== "Workshop.dev") {
    fail("locked-list-title", `og:title is "${ogTitle}" — expected locked-list variant`);
  }
} else if (variant === "friend") {
  if (ogTitle === expectedSiteName || ogTitle === "") {
    fail(
      "friend-fallback-title",
      `og:title is "${ogTitle}" — the friend Pages function didn't fire`,
    );
  }
} else if (variant === "game") {
  if (ogTitle === expectedSiteName || ogTitle === "") {
    fail(
      "game-fallback-title",
      `og:title is "${ogTitle}" — the game-share Pages function didn't fire`,
    );
  }
} else if (ogTitle !== expectedSiteName) {
  fail("default-title", `og:title is "${ogTitle}" (expected "${expectedSiteName}")`);
}

if (site === "highscore") {
  const brandedCopy = [
    ogTitle,
    meta.get("og:description") ?? "",
    meta.get("twitter:title") ?? "",
    meta.get("twitter:description") ?? "",
  ].join(" ");
  if (brandedCopy.includes("Workshop.dev")) {
    fail("wrong-brand-copy", "HighScore metadata still references Workshop.dev");
  }
}

// 2) Fetch og:image, validate PNG bytes + dimensions
const imageUrl = meta.get("og:image");
let pngBytes;
if (imageUrl) {
  try {
    if (
      (variant === "friend" || variant === "game") &&
      new URL(imageUrl).origin !== parsedUrl.origin
    ) {
      fail("og-image-origin", `${imageUrl} is not on ${parsedUrl.origin}`);
    }
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": SCRAPER_UA },
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      fail("og-image-status", `${imageUrl} → ${res.status}`);
    } else if (!contentType.toLowerCase().startsWith("image/png")) {
      fail("og-image-content-type", `${imageUrl} → ${contentType}`);
    } else {
      pngBytes = new Uint8Array(await res.arrayBuffer());
      const dims = readPngDimensions(pngBytes);
      if (!dims) {
        fail("og-image-bytes", "response was not a valid PNG (no IHDR)");
      } else {
        const declaredW = Number(meta.get("og:image:width"));
        const declaredH = Number(meta.get("og:image:height"));
        if (declaredW && declaredW !== dims.width) {
          fail("og-image-width-mismatch", `declared ${declaredW}, actual ${dims.width}`);
        }
        if (declaredH && declaredH !== dims.height) {
          fail("og-image-height-mismatch", `declared ${declaredH}, actual ${dims.height}`);
        }
        if (pngBytes.length < 1000) {
          // ~1KB is below any plausible non-trivial PNG; almost certainly
          // an empty / error response that managed to set the right MIME.
          fail("og-image-suspiciously-small", `${pngBytes.length} bytes`);
        }
      }
    }
  } catch (e) {
    fail("og-image-fetch", `${imageUrl} → ${e.message ?? e}`);
  }
}

// 3) Report
console.log("");
console.log(`  og:title:       ${ogTitle}`);
console.log(`  og:site_name:   ${meta.get("og:site_name") ?? "(missing)"}`);
console.log(`  og:description: ${meta.get("og:description") ?? "(missing)"}`);
console.log(`  og:image:       ${imageUrl ?? "(missing)"}`);
if (pngBytes) {
  const dims = readPngDimensions(pngBytes);
  console.log(
    `  PNG:            ${pngBytes.length} bytes, ${dims?.width ?? "?"}×${dims?.height ?? "?"}`,
  );
}

console.log("");
if (failures.length === 0) {
  console.log("✓ all checks passed");
  process.exit(0);
} else {
  console.error(`✗ ${failures.length} check(s) failed:`);
  for (const { check, detail } of failures) {
    console.error(`  · [${check}] ${detail}`);
  }
  process.exit(1);
}
