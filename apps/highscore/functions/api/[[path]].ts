/**
 * Fixed-upstream, same-origin API bridge for HighScore web. Keeping refresh
 * requests on the Pages origin makes the HttpOnly session cookie first-party.
 */
interface PagesEnv {
  EXPO_PUBLIC_API_URL?: string;
}

interface PagesContext {
  request: Request;
  env: PagesEnv;
}

export const onRequest = async ({ request, env }: PagesContext): Promise<Response> => {
  if (!env.EXPO_PUBLIC_API_URL) {
    return Response.json(
      { error: "api unavailable", code: "INTERNAL" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin) {
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(requestOrigin).origin;
    } catch {
      return Response.json(
        { error: "invalid origin", code: "FORBIDDEN" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (normalizedOrigin !== incomingUrl.origin) {
      return Response.json(
        { error: "cross-origin proxy request", code: "FORBIDDEN" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const upstreamUrl = new URL(env.EXPO_PUBLIC_API_URL);
  const basePath = upstreamUrl.pathname.replace(/\/$/, "");
  const path = incomingUrl.pathname.replace(/^\/api(?=\/|$)/, "").replace(/^\/+/, "");
  upstreamUrl.pathname = `${basePath}/${path}`;
  upstreamUrl.search = incomingUrl.search;
  upstreamUrl.hash = "";

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  // Tell the API who the caller is. The API sees this proxy's Cloudflare
  // address, not the browser's, and keys its per-IP rate limits on what it is
  // told here. `CF-Connecting-IP` is set by Cloudflare's edge; a value the
  // caller sent for our header is discarded.
  headers.delete("x-workshop-client-ip");
  const callerIp = request.headers.get("CF-Connecting-IP");
  if (callerIp) headers.set("x-workshop-client-ip", callerIp);
  headers.set("origin", incomingUrl.origin);

  const method = request.method.toUpperCase();
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
