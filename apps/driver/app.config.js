export default {
  expo: {
    name: "GTaxi Driver",
    slug: "gtaxi-driver",
    scheme: "gtaxi-driver",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#05050A",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gtaxi.driver",
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "remote-notification"],
        NSLocationWhenInUseUsageDescription:
          "GTaxi Driver needs your location to receive ride offers and navigate to riders.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "GTaxi Driver tracks your location in the background to send you nearby ride offers even when the app is minimized.",
        NSLocationAlwaysUsageDescription:
          "GTaxi Driver tracks your location in the background to send you nearby ride offers even when the app is minimized.",
      },
    },
    android: {
      supportsTablet: true,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#05050A",
      },
      package: "com.gtaxi.driver",
      // Android push (Expo push tokens go through FCM). Without this the app
      // could never get a push token, so no notification or SOS reached it.
      googleServicesFile: "./google-services.json",
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
      ],
      allowBackup: false,
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {},
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 34,
            kotlinVersion: "1.9.25",
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            // Release builds shrink code with R8. Stripe's RN SDK references its
            // optional push-provisioning (card-to-wallet) classes, which are not
            // shipped, so R8 stopped with "Missing class" (first full local build,
            // 2026-10-22). Stripe's documented fix is to ignore them. The two keep
            // rules carried over from the old committed android/ folder.
            extraProguardRules: [
              "-keep class com.swmansion.reanimated.** { *; }",
              "-keep class com.facebook.react.turbomodule.** { *; }",
              "-dontwarn com.stripe.android.pushProvisioning.**",
              "-dontwarn com.reactnativestripesdk.pushprovisioning.**",
            ].join("\n"),
          },
        },
      ],
      "expo-notifications",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow GTaxi Driver to track your location in the background to receive local ride offers.",
          locationAlwaysPermission:
            "Allow GTaxi Driver to track your location in the background to receive local ride offers.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          organization: "g-taxi",
          project: "driver",
        },
      ],
      // iOS: the driver app reads NFC tags (NfcIdentityHandler on the
      // dashboard, CommanderRegisterNodeScreen) but had no NFC usage text
      // and no NFC capability -- iOS refuses (or kills the app on) an NFC
      // session without both. This plugin adds NFCReaderUsageDescription and
      // the NDEF+TAG entitlement. Android: library manifest adds the permission.
      [
        "react-native-nfc-manager",
        {
          nfcPermission:
            "GTaxi Driver uses NFC to identify you at G-Touch Points and to register new spots.",
          includeNdefEntitlement: true,
        },
      ],
    ],
    owner: "gtaxis-organization",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        projectId: "a61a1574-ea8e-47b3-9abd-026dc5320fc2",
      },
    },
  },
}
