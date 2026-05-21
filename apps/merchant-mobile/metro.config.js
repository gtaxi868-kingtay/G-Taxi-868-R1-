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

config.resolver.extraNodeModules = {
  'react': path.resolve(projectRoot, 'node_modules/react') || path.resolve(workspaceRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native') || path.resolve(workspaceRoot, 'node_modules/react-native'),
  '@react-navigation/native': path.resolve(projectRoot, 'node_modules/@react-navigation/native') || path.resolve(workspaceRoot, 'node_modules/@react-navigation/native'),
  'react-native-safe-area-context': path.resolve(projectRoot, 'node_modules/react-native-safe-area-context') || path.resolve(workspaceRoot, 'node_modules/react-native-safe-area-context'),
};

module.exports = config;
