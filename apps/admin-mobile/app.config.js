export default {
  expo: {
    name: "G-Taxi Admin",
    slug: "gtaxi-admin",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#0F172A",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.gtaxi.admin",
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      infoPlist: {
        NFCReaderUsageDescription:
          "G-Taxi Admin uses NFC to scan and provision physical pucks at merchant locations and taxi stands.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0F172A",
      },
      package: "com.gtaxi.admin",
      // Android push (Expo push tokens go through FCM). Without this the app
      // could never get a push token, so no notification or SOS reached it.
      googleServicesFile: "./google-services.json",
      permissions: ["android.permission.NFC", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
      // react-native-maps on Android IS Google Maps: without a key the Live
      // Ops map crashed the app the moment it opened (field test 2026-10-21).
      // Same EAS env var the rider and driver apps use.
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    plugins: [
      // G Guardian: SOS alerts are pushed to this phone.
      "expo-notifications",
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 34,
            kotlinVersion: "1.9.25",
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
      // iOS needs the NFC entitlement (NDEF + TAG) to read OR write chips;
      // without this plugin the admin app couldn't use NFC on iPhone at all.
      [
        "react-native-nfc-manager",
        {
          nfcPermission:
            "G-Taxi Admin uses NFC to scan and program touch-point chips and keychains.",
          includeNdefEntitlement: true,
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow G-Taxi Admin to capture GPS coordinates when registering public taxi stands.",
        },
      ],
    ],
    owner: "gtaxi",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        // Real EAS project @gtaxi/gtaxi-admin, created 2026-10-11 (the
        // previous value was a made-up placeholder, so no build could run).
        projectId: "80efd192-24ab-4158-8313-b2e4dcfd9fb9",
      },
    },
  },
}
