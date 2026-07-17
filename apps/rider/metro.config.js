const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the root directory so we can import shared packages
config.watchFolders = [workspaceRoot, ...(config.watchFolders || [])];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Deduplicate React and core libraries to prevent duplicate instance crashes
config.resolver.extraNodeModules = {
  'react': path.resolve(projectRoot, 'node_modules/react') || path.resolve(workspaceRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native') || path.resolve(workspaceRoot, 'node_modules/react-native'),
  '@react-navigation/native': path.resolve(projectRoot, 'node_modules/@react-navigation/native') || path.resolve(workspaceRoot, 'node_modules/@react-navigation/native'),
  'react-native-safe-area-context': path.resolve(projectRoot, 'node_modules/react-native-safe-area-context') || path.resolve(workspaceRoot, 'node_modules/react-native-safe-area-context'),
};

config.resolver.unstable_enablePackageExports = true;
config.resolver.useWatchman = false;

config.resolver.blockList = [
  /(^|\/)node_modules\/ws\//,
  /(\/__tests__\/.*)$/,
];

// ws stub for Supabase Realtime (avoids node:ws resolution failure in RN)
if (!config.resolver.extraNodeModules) config.resolver.extraNodeModules = {};
config.resolver.extraNodeModules.ws = path.resolve(projectRoot, 'ws-stub');

// Web-only resolution fixes (native bundles take the plain path below, untouched).
// These packages are native-only — they pull in react-native internals (codegen commands,
// TextInputState → Utilities/Platform) that crash Metro's web bundler — so redirect them
// to placeholder stubs when bundling for web.
const WEB_STUBS = {
  'react-native-maps': 'packages/shared/web-stubs/react-native-maps.js',
  '@stripe/stripe-react-native': 'packages/shared/web-stubs/stripe-react-native.js',
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return {
      filePath: path.resolve(workspaceRoot, WEB_STUBS[moduleName]),
      type: 'sourceFile',
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
