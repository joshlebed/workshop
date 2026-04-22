// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so changes in @workshop/shared live-reload.
config.watchFolders = [workspaceRoot];

// Resolve packages from the app's node_modules first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm symlinks each package; follow them.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
