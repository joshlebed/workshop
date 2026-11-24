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

// The plain-JS QuickJS build (src/games/lib/scoreEngine.ts) carries a branch
// that only runs under Node and does `await import("module")`. It is never
// taken in the app, but Metro resolves every specifier it sees: on web Node
// built-ins already resolve to an empty module, on native they do not, and
// the iOS bundle failed with "Unable to resolve module module". Scoped to
// that one package so a real missing module still fails the build.
const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "module" && context.originModulePath.includes("quickjs-asmjs-mjs")) {
    return { type: "empty" };
  }
  return (prevResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
