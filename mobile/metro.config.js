// Metro config that lets the app import the sibling `@aster/shared` package.
// npm installs it as a symlink (node_modules/@aster/shared -> ../shared), so we
// only need to add the shared folder to watchFolders for file-watching. We do
// NOT add the repo root's node_modules to resolution: it holds the WEB app's
// deps (React 19) which would clash with this app's React 18.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "..", "shared");

const config = getDefaultConfig(projectRoot);

// Watch the shared package so edits to it hot-reload. Metro (SDK 52) follows the
// symlink for resolution; this just lets it see the files change.
config.watchFolders = [sharedRoot];

// Resolve modules only from THIS app's node_modules. (Default, stated explicitly
// so nobody re-adds the repo root and reintroduces the React version clash.)
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
