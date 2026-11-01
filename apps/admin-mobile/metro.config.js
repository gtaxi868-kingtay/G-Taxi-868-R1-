const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot, ...(config.watchFolders || [])];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Watchman does not index this monorepo reliably (hoisted packages such as
// @babel/runtime went missing); the rider app turns it off for the same reason.
config.resolver.useWatchman = false;

config.resolver.extraNodeModules = {
  'react': path.resolve(projectRoot, 'node_modules/react') || path.resolve(workspaceRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native') || path.resolve(workspaceRoot, 'node_modules/react-native'),
};

// Web preview only: native-only packages get placeholder stubs (the maps stub
// shows a still Mapbox image), same as the rider app. Native builds untouched.
const WEB_STUBS = {
  'react-native-maps': 'packages/shared/web-stubs/react-native-maps.js',
};
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return { filePath: path.resolve(workspaceRoot, WEB_STUBS[moduleName]), type: 'sourceFile' };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
