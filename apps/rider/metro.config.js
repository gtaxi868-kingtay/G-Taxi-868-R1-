const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(projectRoot);

// Watch the root directory so we can import 'shared'
config.watchFolders = [workspaceRoot];

// Ensure Metro looks into the project node_modules for dependencies of files in 'shared'
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
