export default {
  expo: {
    name: "G Taxi Rider",
    slug: "g-taxi-rider",
    scheme: "gtaxi",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/logo.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#05050A",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gtaxi.rider",
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "remote-notification"],
        NSLocationWhenInUseUsageDescription:
          "G-Taxi needs your location to show available drivers and set your pickup point.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "G-Taxi tracks your ride location to ensure security and accurate fare calculation, even when the app is in the background.",
        NSLocationAlwaysUsageDescription:
          "G-Taxi tracks your ride location to ensure security and accurate fare calculation, even when the app is in the background.",
        NFCReaderUsageDescription:
          "G-Taxi uses NFC to instantly book rides at taxi stands and partner locations.",
      },
    },
    android: {
      supportsTablet: true,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#05050A",
      },
      package: "com.gtaxi.rider",
      // Android push (Expo push tokens go through FCM). Without this the app
      // could never get a push token, so no notification or SOS reached it.
      googleServicesFile: "./google-services.json",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: false,
          data: [{ scheme: "gtaxi" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.NFC",
      ],
      allowBackup: false,
    },
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
          ios: {
            useFrameworks: "static",
            deploymentTarget: "15.1",
          },
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "Allow G-Taxi to access your camera for scanning items.",
          recordAudioAndroid: false,
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow G-Taxi to use your location to find nearby drivers.",
        },
      ],
      [
        "@sentry/react-native/expo",
        {
          organization: "g-taxi",
          project: "rider",
        },
      ],
      "./plugins/withDeleteMapsInterfaces",
      // iOS: adds the NFC capability (com.apple.developer.nfc.readersession.formats
      // NDEF+TAG) that NfcScan/NfcHandshake need for NfcTech.NfcA. Without it,
      // requestTechnology fails on every iPhone. Android needs nothing here:
      // the library's own manifest already merges in android.permission.NFC.
      [
        "react-native-nfc-manager",
        {
          nfcPermission:
            "G-Taxi uses NFC to instantly book rides at taxi stands and partner locations.",
          includeNdefEntitlement: true,
        },
      ],
      ["@stripe/stripe-react-native", {}],
      "expo-notifications",
    ],
    owner: "gtaxis-organization",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        projectId: "0ba46182-9e49-45e7-85e3-bffd3c036bbf",
      },
      legal_terms_url: "https://gtaxi.tt/legal/terms",
      legal_privacy_url: "https://gtaxi.tt/legal/privacy",
    },
  },
}
