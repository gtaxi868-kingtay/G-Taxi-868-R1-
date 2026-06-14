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
      permissions: ["android.permission.NFC", "android.permission.POST_NOTIFICATIONS"],
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
    ],
    owner: "gtaxi",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        projectId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      },
    },
  },
}
