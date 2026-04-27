import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * SSRF guard for outbound `fetch` calls. Used by the link-preview route
 * (Phase 2a-2). The strategy is to resolve the hostname ourselves and
 * inspect every resolved IP against a deny list before opening a socket —
 * `fetch` won't tell us which IP it actually connected to, and an attacker
 * can flip DNS / 30x to a private range between checks. Every redirect hop
 * therefore re-runs `assertHostnameSafe`.
 *
 * The deny list covers everything `ipaddr.js` flags as not-`unicast` (loopback,
 * private, link-local, multicast, reserved, broadcast, unspecified) plus the
 * AWS metadata IP family explicitly so the regression test for
 * `169.254.169.254` is unambiguous even though `link-local` already covers it.
 */

export class SsrfBlockedError extends Error {
  readonly reason: string;
  readonly host: string;
  constructor(host: string, reason: string) {
    super(`ssrf: ${reason} (${host})`);
    this.reason = reason;
    this.host = host;
    this.name = "SsrfBlockedError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// IPv4 ranges that ipaddr.js classifies as `unicast` but we still want to
// block — currently just an explicit AWS metadata catch in case ipaddr.js's
// `link-local` bucket is loosened in a future major.
const EXTRA_DENY_V4: ReadonlyArray<readonly [string, number]> = [["169.254.169.254", 32]];

const ALLOWED_IPV4_RANGES = new Set(["unicast"]);
const ALLOWED_IPV6_RANGES = new Set(["unicast"]);

function isExtraDeniedV4(addr: ipaddr.IPv4): boolean {
  return EXTRA_DENY_V4.some(([ip, prefix]) => addr.match(ipaddr.IPv4.parse(ip), prefix));
}

/**
 * Returns `null` when the IP is in an allowed (public unicast) range, otherwise
 * a short reason string describing the block.
 */
export function classifyIp(ip: string): { ok: true } | { ok: false; reason: string } {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return { ok: false, reason: "unparseable ip" };
  }

  // ipaddr.js returns IPv6 for `::ffff:a.b.c.d`-style mapped addresses; treat
  // them as their underlying IPv4 so the same deny list applies.
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      const v4 = v6.toIPv4Address();
      const range = v4.range();
      if (!ALLOWED_IPV4_RANGES.has(range)) return { ok: false, reason: `ipv4 range: ${range}` };
      if (isExtraDeniedV4(v4)) return { ok: false, reason: "ipv4 range: aws-metadata" };
      return { ok: true };
    }
    const range = v6.range();
    if (!ALLOWED_IPV6_RANGES.has(range)) return { ok: false, reason: `ipv6 range: ${range}` };
    return { ok: true };
  }

  const v4 = parsed as ipaddr.IPv4;
  const range = v4.range();
  if (!ALLOWED_IPV4_RANGES.has(range)) return { ok: false, reason: `ipv4 range: ${range}` };
  if (isExtraDeniedV4(v4)) return { ok: false, reason: "ipv4 range: aws-metadata" };
  return { ok: true };
}

/**
 * Validates a URL string for outbound fetch:
 * - parseable as an absolute http(s) URL
 * - not a userinfo URL (`http://user:pw@host/`) — those are commonly used to
 *   smuggle confusing hostnames past humans
 * - hostname is not empty
 * - if hostname is an IP literal, the IP is in an allowed (public unicast)
 *   range. The DNS-based check for hostname-based URLs runs later in
 *   `assertHostnameSafe` (called per redirect hop by the fetcher).
 *
 * Returns the parsed URL on success; throws `SsrfBlockedError` otherwise.
 */
export function parseAndValidateUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfBlockedError(input, "invalid url");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(url.href, `protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError(url.href, "userinfo not allowed");
  }
  if (!url.hostname) {
    throw new SsrfBlockedError(url.href, "missing hostname");
  }
  const literal = parseLiteralIp(url.hostname);
  if (literal) {
    const verdict = classifyIp(literal);
    if (!verdict.ok) {
      throw new SsrfBlockedError(url.hostname, verdict.reason);
    }
  }
  return url;
}

/**
 * Resolves the hostname (or accepts a literal IP) and throws `SsrfBlockedError`
 * if any resolved address falls in a denied range.
 *
 * If the hostname is already an IP literal, the DNS step is skipped — `URL`
 * would happily accept `http://10.0.0.1/` and we want the deny check to fire
 * without paying a DNS round trip.
 */
export async function assertHostnameSafe(
  hostname: string,
  deps: { resolve?: (hostname: string) => Promise<LookupAddress[]> } = {},
): Promise<void> {
  const literal = parseLiteralIp(hostname);
  if (literal) {
    const verdict = classifyIp(literal);
    if (!verdict.ok) throw new SsrfBlockedError(hostname, verdict.reason);
    return;
  }

  const resolver = deps.resolve ?? defaultResolve;
  let addrs: LookupAddress[];
  try {
    addrs = await resolver(hostname);
  } catch (error) {
    throw new SsrfBlockedError(hostname, `dns lookup failed: ${(error as Error).message}`);
  }
  if (addrs.length === 0) {
    throw new SsrfBlockedError(hostname, "dns returned no addresses");
  }
  for (const a of addrs) {
    const verdict = classifyIp(a.address);
    if (!verdict.ok) {
      throw new SsrfBlockedError(hostname, `${verdict.reason} for ${a.address}`);
    }
  }
}

function parseLiteralIp(hostname: string): string | null {
  // URL hostnames wrap IPv6 in brackets. Strip them before parse.
  const stripped =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!ipaddr.isValid(stripped)) return null;
  return stripped;
}

async function defaultResolve(hostname: string): Promise<LookupAddress[]> {
  return await dnsLookup(hostname, { all: true, verbatim: true });
}
