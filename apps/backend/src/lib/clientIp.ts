import type { Context } from "hono";
import ipaddr from "ipaddr.js";

/**
 * The caller's IP address, from a source the caller cannot choose.
 *
 * `X-Forwarded-For` is not that: API Gateway appends the real address to
 * whatever the client sent, so its first entry is client-controlled. Keying
 * per-IP rate limits on it let anyone dodge them with a new header value per
 * request, and put made-up addresses in the request log.
 *
 * The trusted fact is the address API Gateway itself accepted the connection
 * from (`requestContext.http.sourceIp`). For native clients that is the
 * device. Web traffic arrives through our Cloudflare Pages `/api` proxy
 * (functions/api/[[path]].ts), so the gateway sees a Cloudflare address; the
 * proxy passes on the address Cloudflare saw in `X-Workshop-Client-Ip`, and
 * that header is believed only when the connection really came from
 * Cloudflare's network.
 *
 * Residual gap: someone running their own Cloudflare Worker also connects from
 * Cloudflare's network and could set the header. Closing it needs a secret
 * shared between the proxy and this API.
 */
const PROXY_CLIENT_IP_HEADER = "X-Workshop-Client-Ip";

// https://www.cloudflare.com/ips/ (fetched 2026-11-20). If this goes stale the
// failure is mild: web callers behind a missing range share one bucket.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
].map((cidr) => ipaddr.parseCIDR(cidr));

type Address = ReturnType<typeof ipaddr.process>;

function parse(value: string | undefined | null): Address | null {
  const text = value?.trim();
  if (!text || !ipaddr.isValid(text)) return null;
  // `process` turns an IPv4-mapped IPv6 address back into IPv4.
  return ipaddr.process(text);
}

function isCloudflare(address: Address): boolean {
  return CLOUDFLARE_RANGES.some(
    ([network, bits]) => address.kind() === network.kind() && address.match(network, bits),
  );
}

/** The address the connection to this API came from, per the runtime. */
function connectionIp(c: Context): string | null {
  const env = c.env as
    | {
        // hono/aws-lambda: the API Gateway event.
        event?: { requestContext?: { http?: { sourceIp?: string } } };
        // @hono/node-server (local dev): the Node request.
        incoming?: { socket?: { remoteAddress?: string } };
      }
    | undefined;
  return env?.event?.requestContext?.http?.sourceIp ?? env?.incoming?.socket?.remoteAddress ?? null;
}

/** The caller's IP, or null when the runtime does not say (unit tests). */
export function callerIp(c: Context): string | null {
  const connection = parse(connectionIp(c));
  if (!connection) return null;
  if (isCloudflare(connection)) {
    const forwarded = parse(c.req.header(PROXY_CLIENT_IP_HEADER));
    if (forwarded) return forwarded.toString();
  }
  return connection.toString();
}

/** Rate-limit key for per-IP limits: every caller with no known address shares one bucket. */
export function callerIpKey(c: Context): string {
  return callerIp(c) ?? "unknown";
}
