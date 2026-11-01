export default {
  expo: {
    name: "G-Taxi Merchant",
    slug: "gtaxi-merchant",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#F0FDF4",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gtaxi.merchant",
      infoPlist: {
        NFCReaderUsageDescription:
          "G-Taxi Merchant uses NFC to accept customer check-ins and tag identification.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#F0FDF4",
      },
      package: "com.gtaxi.merchant",
      // Android push (Expo push tokens go through FCM). Without this the app
      // could never get a push token, so no notification or SOS reached it.
      googleServicesFile: "./google-services.json",
      permissions: ["android.permission.NFC", "android.permission.POST_NOTIFICATIONS", "android.permission.RECORD_AUDIO"],
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            kotlinVersion: "1.9.25",
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
          ios: {
            useFrameworks: "static",
            deploymentTarget: "15.1",
          },
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow G-Taxi Merchant to use your location to receive nearby delivery offers.",
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      "expo-notifications",
      "react-native-nfc-manager",
    ],
    owner: "gtaxi",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        // Real EAS project @gtaxi/gtaxi-merchant, created 2026-10-13. The
        // previous value (b2c3d4e5-...) was a placeholder Expo rejected.
        projectId: "e4b52330-878c-4a23-be66-f7ce8d8b35cd",
      },
    },
  },
}
