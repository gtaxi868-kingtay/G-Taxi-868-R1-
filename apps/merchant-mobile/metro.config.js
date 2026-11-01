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
  '@react-navigation/native': path.resolve(projectRoot, 'node_modules/@react-navigation/native') || path.resolve(workspaceRoot, 'node_modules/@react-navigation/native'),
  'react-native-safe-area-context': path.resolve(projectRoot, 'node_modules/react-native-safe-area-context') || path.resolve(workspaceRoot, 'node_modules/react-native-safe-area-context'),
};

module.exports = config;
