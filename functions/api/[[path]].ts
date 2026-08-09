/**
 * Same-origin API bridge for the web app. Keeping `/v1/auth/refresh` on the
 * Pages origin makes its HttpOnly cookie first-party; the fixed upstream URL
 * prevents this function from becoming an open proxy.
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
  // Assigning pathname (instead of resolving a URL-shaped user string) keeps
  // even `/api//example.com/...` pinned to the configured upstream origin.
  upstreamUrl.pathname = `${basePath}/${path}`;
  upstreamUrl.search = incomingUrl.search;
  upstreamUrl.hash = "";

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  // The proxy is same-origin only. Overwrite rather than trust a caller's
  // value so backend CORS and browser-cookie detection see the Pages origin.
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
