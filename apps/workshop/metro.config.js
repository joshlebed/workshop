const { getDefaultConfig } = require("expo/metro-config");

// Expo's monorepo defaults already watch each workspace package and resolve
// from both the project and workspace-root node_modules. Combined with
// shamefully-hoist=true in .npmrc, no overrides are needed.
module.exports = getDefaultConfig(__dirname);
