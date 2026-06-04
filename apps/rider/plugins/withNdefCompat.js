const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Config plugin to patch react-native-nfc-manager for Android API 33+ compatibility.
 *
 * Android SDK 33+ removed the deprecated setNdefPushMessage API.
 * This plugin inserts a Gradle task that patches the Java source before compilation,
 * wrapping the call in an SDK version check so it only executes on API < 33.
 */
const withNdefCompat = (config) => {
  return withProjectBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents + `
// G-Taxi One Engine: Patch react-native-nfc-manager for API 33+
tasks.register('patchNfcManager') {
    def nfcFile = file("\${rootProject.projectDir}/../node_modules/react-native-nfc-manager/android/src/main/java/community/revteltech/nfc/NfcManager.java")
    if (nfcFile.exists()) {
        def content = nfcFile.text
        def patched = content.replaceAll(
            /nfcAdapter\\.setNdefPushMessage\\(msgToPush, currentActivity\\);/,
            '''if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) {
                        nfcAdapter.setNdefPushMessage(msgToPush, currentActivity);
                    }'''
        )
        if (content != patched) {
            nfcFile.text = patched
            println "G-Taxi: Patched NfcManager.java for API 33+"
        }
    }
}

project.afterEvaluate {
    tasks.matching { it.name.startsWith('merge') && it.name.endsWith('NativeLibs') }.configureEach {
        dependsOn tasks.named('patchNfcManager')
    }
}

`;
    return config;
  });
};

module.exports = withNdefCompat;
