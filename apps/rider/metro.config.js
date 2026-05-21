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

// Retain ws stub from original config
if (!config.resolver.extraNodeModules) config.resolver.extraNodeModules = {};
config.resolver.extraNodeModules.ws = path.resolve(projectRoot, 'node_modules/.ws-stub');

module.exports = config;
