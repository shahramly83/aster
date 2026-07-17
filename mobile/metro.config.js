// Metro config that lets the app import the sibling `@aster/shared` package
// WITHOUT installing it as an npm `file:` dependency. A file: dep creates a
// symlink in node_modules that disrupts npm's hoisting (Expo's transitive deps
// end up nested and unresolvable). Instead we alias the bare specifier straight
// to ../shared and watch that folder so edits hot-reload.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "..", "shared");

const config = getDefaultConfig(projectRoot);

// Let Metro see the shared package's files (it lives outside projectRoot).
config.watchFolders = [sharedRoot];

// Resolve `@aster/shared` -> ../shared. Everything else resolves normally from
// this app's own node_modules.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@aster/shared": sharedRoot,
};

module.exports = config;
