export default {
  expo: {
    name: "G Taxi Rider",
    slug: "g-taxi-rider",
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
      "./plugins/withNdefCompat",
      ["@stripe/stripe-react-native", {}],
      "expo-notifications",
    ],
    owner: "gtaxi",
    extra: {
      EXPO_USE_METRO_WORKSPACE_ROOT: "1",
      eas: {
        projectId: "f4f49272-bb2c-4a6d-8a35-caff959079dc",
      },
      legal_terms_url: "https://gtaxi.tt/legal/terms",
      legal_privacy_url: "https://gtaxi.tt/legal/privacy",
    },
  },
}
