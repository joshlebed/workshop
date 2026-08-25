// Proxies `/api/*` on the Expo web dev server to the local backend on
// `localhost:${BACKEND_PORT}` (default 8787). This keeps API calls
// same-origin in the Niteshift sandbox, where the preview proxy gates
// the `ns-8787-…preview.niteshift.dev` host with a 401 HTML page and
// breaks any cross-origin fetch from the web bundle.
const http = require("node:http");

const BACKEND_HOST = process.env.DEV_API_PROXY_HOST || "127.0.0.1";
const BACKEND_PORT = Number(process.env.DEV_API_PROXY_PORT || process.env.PORT || 8787);
const PREFIX = "/api";

function devApiProxy(req, res, next) {
  if (!req.url || (!req.url.startsWith(`${PREFIX}/`) && req.url !== PREFIX)) {
    return next();
  }

  const forwardedPath = req.url.slice(PREFIX.length) || "/";
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  const upstream = http.request(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      method: req.method,
      path: forwardedPath,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: `dev api proxy: ${err.message}`, code: "PROXY_ERROR" }));
  });

  req.pipe(upstream);
}

module.exports = { devApiProxy };
