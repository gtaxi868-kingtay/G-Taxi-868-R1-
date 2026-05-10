const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Config plugin to delete the broken ViewManagerWithGeneratedInterface files in react-native-maps
 * that cause compilation errors on React Native 0.76+.
 */
const withDeleteMapsInterfaces = (config) => {
  return withProjectBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents + `
// G-Taxi One Engine: Kill broken maps interfaces
allprojects {
    afterEvaluate { project ->
        if (project.name.contains('react-native-maps')) {
            def brokenFolder = file("\${project.projectDir}/src/main/java/com/facebook/react/viewmanagers")
            if (brokenFolder.exists()) {
                println "G-Taxi: Deleting broken ViewManager interfaces in \${project.name}"
                brokenFolder.deleteDir()
            }
        }
    }
}
`;
    return config;
  });
};

module.exports = withDeleteMapsInterfaces;
