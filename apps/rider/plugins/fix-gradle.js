const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to remove the 'enableBundleCompression' property from the 'react' block
 * in the generated android/app/build.gradle. This property is not supported by some versions
 * of the React Native Gradle plugin.
 */
const withFixGradle = (config) => {
    return withAppBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            config.modResults.contents = config.modResults.contents.replace(
                /^\s*enableBundleCompression\s*=\s*.*$/m,
                "    // Removed by config-plugin fix-gradle.js"
            );
        }
        return config;
    });
};

module.exports = withFixGradle;
