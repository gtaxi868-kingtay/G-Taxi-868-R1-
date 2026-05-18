const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch the root directory so we can import 'shared'
config.watchFolders = [workspaceRoot];

// Ensure Metro looks into the project node_modules for dependencies of files in 'shared'
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// Deduplicate React and other core libraries to prevent "Double React" crashes
// We force resolution to the root node_modules since this is a hoisted monorepo
const extraNodeModules = {
    'react': path.resolve(workspaceRoot, 'node_modules/react'),
    'react-native': path.resolve(workspaceRoot, 'node_modules/react-native'),
    '@react-navigation/native': path.resolve(workspaceRoot, 'node_modules/@react-navigation/native'),
    'react-native-safe-area-context': path.resolve(workspaceRoot, 'node_modules/react-native-safe-area-context'),
};

config.resolver.extraNodeModules = new Proxy(extraNodeModules, {
    get: (target, name) => {
        if (target[name]) {
            return target[name];
        }
        return path.join(projectRoot, `node_modules/${name}`);
    },
});


module.exports = config;
