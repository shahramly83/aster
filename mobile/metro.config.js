// Metro config that lets the app import the sibling `@aster/shared` package that
// lives at ../shared (outside mobile/). We watch the repo root so edits to shared
// hot-reload, and let Metro resolve modules from both node_modules folders.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the repo root so changes in ../shared trigger a reload.
config.watchFolders = [repoRoot];

// Resolve packages from the app first, then the repo root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
