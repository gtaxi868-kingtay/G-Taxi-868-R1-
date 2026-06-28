// Shim globalThis.expo before any module imports (needed by expo-modules-core)
if (!globalThis.expo) {
  globalThis.expo = {};
}
if (!globalThis.expo.EventEmitter) {
  globalThis.expo.EventEmitter = class {
    constructor() {}
    addListener() { return { remove: jest.fn() }; }
    removeAllListeners() {}
    emit() {}
    listenerCount() { return 0; }
  };
}
if (!globalThis.expo.modules) {
  globalThis.expo.modules = {};
}

// ---- Mock native module core (root cause of EventEmitter crash) ----
jest.mock('expo-modules-core', () => {
  class EventEmitter {
    constructor() {}
    addListener() { return { remove: jest.fn() }; }
    removeAllListeners() {}
    emit() {}
    listenerCount() { return 0; }
  }
  return {
    EventEmitter,
    NativeModulesProxy: new Proxy({}, { get: () => ({}) }),
    requireNativeModule: () => ({}),
    requireOptionalNativeModule: () => ({}),
    requireNativeViewManager: () => 'View',
    ProxyNativeModule: class {},
    CodedError: class extends Error {},
    UnavailabilityError: class extends Error {},
  };
});

// ---- Individual expo package mocks ----
jest.mock('expo-blur', () => ({
  BlurView: ({ children, ...rest }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, rest, children);
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...rest }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, rest, children);
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
  setStatusBarStyle: jest.fn(),
  setStatusBarHidden: jest.fn(),
  setStatusBarNetworkActivityIndicatorVisible: jest.fn(),
  setStatusBarBackgroundColor: jest.fn(),
  setStatusBarTranslucent: jest.fn(),
  StatusBarStyle: { AUTO: 'auto', INVERTED: 'inverted', LIGHT: 'light', DARK: 'dark' },
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({ coords: { latitude: 10, longitude: -61 } })),
  watchPositionAsync: jest.fn(() => ({ remove: jest.fn() })),
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { High: 'High', Balanced: 'Balanced', Low: 'Low' },
}));

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  CameraType: { front: 'front', back: 'back' },
  useCameraPermissions: jest.fn(() => [true, jest.fn()]),
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getAvailableVideoCodecsAsync: jest.fn(),
}));

jest.mock('expo-constants', () => {
  const AppOwnership = { Expo: 'expo', Standalone: 'standalone', Guest: 'guest' };
  const ExecutionEnvironment = { StoreClient: 'storeClient', Bare: 'bare', Standalone: 'standalone' };
  const constants = {
    appOwnership: 'standalone',
    expoConfig: {},
    manifest: {},
    executionEnvironment: 'storeClient',
    isDevice: false,
    nativeAppVersion: '1.0.0',
    nativeBuildVersion: '1',
    platform: { android: { versionCode: 1 } },
    sessionId: 'test-session',
    statusBarHeight: 0,
    AppOwnership,
    ExecutionEnvironment,
  };
  constants.default = constants;
  return constants;
});

// ---- Mock design-system packages to avoid native component resolution ----
jest.mock('@gtaxi/design-system-native', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    VOICES: {
      rider: {
        bg: '#050505', surface: 'rgba(255,255,255,0.04)', text: '#FFFFFF',
        textMuted: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.12)',
        accent: '#00FFFF', accentDark: '#00CCCC',
      },
      driver: {
        bg: '#050505', surface: '#0A0A0A', surfaceHigh: 'rgba(10,10,10,0.8)',
        text: '#FFFFFF', textMuted: 'rgba(255,255,255,0.5)', gold: '#F59E0B',
        accent: '#00FFFF', accentDark: '#00CCCC',
      },
      admin: { bg: '#0F172A', surface: '#1E293B', accent: '#3b374a', accentDark: '#2a2735', text: '#F1F5F9' },
      merchant: { bg: '#09090B', surface: 'rgba(255,255,255,0.06)', accent: '#007070', accentDark: '#004f4f', text: '#FFFFFF', textMuted: 'rgba(255,255,255,0.7)' },
    },
    SURFACE: { base: '#050505', containerLow: '#0A0A0A', containerHigh: '#1A1A1A', containerHighest: '#2A2A2A' },
    SEMANTIC: { error: '#FF6E84', success: '#00FFAA', warning: '#F59E0B' },
    BRAND: { purple: '#7F00FF', cyan: '#00FFFF', gold: '#F59E0B', obsidian: '#050505' },
    RADIUS: { sm: 12, md: 20, lg: 28, xl: 36 },
    SPACING: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    GRADIENTS: { primary: ['#00FFFF', '#7F00FF'], primaryStart: { x: 0, y: 0 }, primaryEnd: { x: 1, y: 1 } },
    SHADOW_PROFILE: { shadowColor: '#00FFFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24 },
    Logo: ({ size, variant }) => React.createElement(View, null, React.createElement(Text, null, 'Logo')),
    GlassCard: ({ children, style, variant }) => React.createElement(View, { style }, children),
    Skeleton: ({ width, height, borderRadius }) => React.createElement(View, { style: { width, height, borderRadius } }),
    WalletCard: ({ balanceCents, currency, onTopUp, variant }) => React.createElement(View, null, React.createElement(Text, null, `${currency || 'TTD'} ${((balanceCents || 0) / 100).toFixed(2)}`)),
    PrimaryButton: 'PrimaryButton',
    InfoChip: 'InfoChip',
    StatusBadge: 'StatusBadge',
    LoadingOverlay: 'LoadingOverlay',
    Txt: ({ children }) => React.createElement(Text, null, children),
  };
});

jest.mock('@gtaxi/design-system', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    SURFACE: { base: '#050505', containerLow: '#0A0A0A', containerHigh: '#1A1A1A', containerHighest: '#2A2A2A' },
    Z: { mapContent: 1, mapOverlay: 10, panel: 20, lockOverlay: 30, locationConfirm: 40, sidebar: 50, modal: 60, toast: 70, offlineBanner: 80 },
    SHADOW_PROFILE: { shadowColor: '#00FFFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24 },
    ANIMATION: { easing: [0.16, 1, 0.3, 1], spring: { damping: 18, stiffness: 150, mass: 1 } },
    VOICES: {
      rider: {
        bg: '#050505', surface: 'rgba(255,255,255,0.04)', text: '#FFFFFF',
        textMuted: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.12)',
        accent: '#00FFFF', accentDark: '#00CCCC',
      },
      driver: {
        bg: '#050505', surface: '#0A0A0A', surfaceHigh: 'rgba(10,10,10,0.8)',
        text: '#FFFFFF', textMuted: 'rgba(255,255,255,0.5)', gold: '#F59E0B',
        accent: '#00FFFF', accentDark: '#00CCCC',
      },
      admin: { bg: '#0F172A', surface: '#1E293B', accent: '#3b374a', accentDark: '#2a2735', text: '#F1F5F9' },
      merchant: { bg: '#09090B', surface: 'rgba(255,255,255,0.06)', accent: '#007070', accentDark: '#004f4f', text: '#FFFFFF', textMuted: 'rgba(255,255,255,0.7)' },
    },
    tokens: {
      colors: {
        background: { base: '#050505', ambient: '#050505' },
        text: { primary: '#FFFFFF', secondary: 'rgba(255,255,255,0.5)', tertiary: 'rgba(255,255,255,0.3)', inverse: '#FFFFFF' },
        border: { subtle: 'rgba(255,255,255,0.15)' },
        primary: { cyan: '#00FFFF', purple: '#7F00FF', gradient: ['#00FFFF', '#7F00FF'] },
        status: { error: '#FF6E84' },
        glass: { fill: 'rgba(0,255,255,0.06)', strokeHighlight: 'rgba(255,255,255,0.08)' },
      },
    },
    GlassCard: ({ children, style }) => React.createElement(View, { style }, children),
    Skeleton: () => React.createElement(View, null),
    Logo: () => React.createElement(View, null, React.createElement(Text, null, 'Logo')),
    WalletCard: () => React.createElement(View, null, React.createElement(Text, null, 'WalletCard')),
  };
});

jest.mock('@gtaxi/design-system/utils/style-rules', () => ({
  elevationGlow: () => ({ shadowColor: '#00FFFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24 }),
  ghostBorder: () => ({ borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }),
  glassSurface: () => ({ backgroundColor: 'rgba(5,5,5,0.2)', overflow: 'hidden' }),
}));

jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
  fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = ({ children }) => React.createElement(View, null, children);
  MapView.__esModule = true;
  MapView.default = MapView;
  return {
    __esModule: true,
    default: MapView,
    MapView,
    Marker: ({ children }) => React.createElement(View, null, children),
    PROVIDER_DEFAULT: 'google',
    UrlTile: ({ urlTemplate }) => React.createElement(View, null),
    Polyline: ({ coordinates }) => React.createElement(View, null),
    Circle: ({ center, radius }) => React.createElement(View, null),
    Animated: {
      MapView: ({ children }) => React.createElement(View, null, children),
      Marker: ({ children }) => React.createElement(View, null, children),
    },
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = ({ name, size, color, ...rest }) => React.createElement(Text, rest, `[${name}]`);
  return {
    Ionicons: Icon,
    MaterialIcons: Icon,
    MaterialCommunityIcons: Icon,
    Feather: Icon,
    FontAwesome: Icon,
    FontAwesome5: Icon,
    AntDesign: Icon,
    Entypo: Icon,
    EvilIcons: Icon,
    Foundation: Icon,
    Octicons: Icon,
    SimpleLineIcons: Icon,
    Zocial: Icon,
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => {
      const React = require('react');
      const { View } = require('react-native');
      return React.createElement(View, null, children);
    },
    SafeAreaView: ({ children }) => {
      const React = require('react');
      const { View } = require('react-native');
      return React.createElement(View, null, children);
    },
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

jest.mock('@gtaxi/core', () => {
  const ok = (data = null) => Promise.resolve({ data, error: null });
  const builder = {};
  for (const m of ['select','insert','update','delete','upsert','eq','neq','in','not','is',
                   'gte','lte','gt','lt','like','ilike','order','limit','range','filter',
                   'contains','match','or','overlaps']) { builder[m] = () => builder; }
  builder.single = () => ok(null);
  builder.maybeSingle = () => ok(null);
  builder.then = (cb) => ok([]).then(cb);
  const channelObj = { on: () => channelObj, subscribe: jest.fn(() => channelObj), unsubscribe: jest.fn() };
  const supabaseMock = {
    channel: () => channelObj, removeChannel: jest.fn(), removeAllChannels: jest.fn(),
    from: () => builder, rpc: () => builder,
    functions: { invoke: jest.fn(() => ok(null)) },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'test-user' }, access_token: 'test-token' } }, error: null }),
      getUser: () => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null }),
      signOut: jest.fn(() => ok(null)),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    storage: { from: () => ({ upload: jest.fn(() => ok(null)), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  return {
    supabase: supabaseMock,
    initializeSupabaseClient: () => ({ supabase: supabaseMock }),
    ENV: { SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'anon', MAPBOX_PUBLIC_TOKEN: '', STRIPE_PUBLISHABLE_KEY: '' },
    DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 },
    haversineMeters: jest.fn(() => 0), isWithinRadius: jest.fn(() => true), checkGeofenceZone: jest.fn(() => null),
    OutboxService: { getInstance: () => ({ enqueue: jest.fn(), process: jest.fn(), getPendingCount: jest.fn(() => Promise.resolve(0)), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) },
  };
});

// ---- NFC (native, unavailable in jest) ----
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(() => Promise.resolve()),
    isSupported: jest.fn(() => Promise.resolve(true)),
    requestTechnology: jest.fn(() => Promise.resolve()),
    cancelTechnologyRequest: jest.fn(() => Promise.resolve()),
    getTag: jest.fn(() => Promise.resolve(null)),
    setEventListener: jest.fn(),
    registerTagEvent: jest.fn(() => Promise.resolve()),
    unregisterTagEvent: jest.fn(() => Promise.resolve()),
    setAlertMessageIOS: jest.fn(),
  },
  NfcTech: { Ndef: 'Ndef', NfcA: 'NfcA', NfcV: 'NfcV', IsoDep: 'IsoDep' },
  Ndef: { text: { decodePayload: jest.fn(() => '') }, encodeMessage: jest.fn(() => []), textRecord: jest.fn(() => ({})), uriRecord: jest.fn(() => ({})) },
  NfcEvents: { DiscoverTag: 'DiscoverTag', SessionClosed: 'SessionClosed' },
}));
