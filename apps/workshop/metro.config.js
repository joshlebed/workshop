const { getDefaultConfig } = require("expo/metro-config");
const { devApiProxy } = require("./dev-api-proxy");

// Expo's monorepo defaults already watch each workspace package and resolve
// from both the project and workspace-root node_modules. Combined with
// shamefully-hoist=true in .npmrc, no overrides are needed.
const config = getDefaultConfig(__dirname);

// Same-origin `/api/*` → backend, so the web bundle never has to cross the
// Niteshift preview proxy's per-port auth wall. See dev-api-proxy.js.
const prevEnhance = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const next = prevEnhance ? prevEnhance(middleware, server) : middleware;
    return (req, res, fallback) => devApiProxy(req, res, () => next(req, res, fallback));
  },
};

module.exports = config;
