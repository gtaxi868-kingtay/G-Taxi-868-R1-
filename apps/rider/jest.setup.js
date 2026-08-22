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
  const ExecutionEnvironment = { StoreClient: 'storeClient', Bare: 'bare', Standalone: 'standalone' };
  const constants = {
    expoConfig: {},
    manifest: {},
    executionEnvironment: 'storeClient',
    isDevice: false,
    nativeAppVersion: '1.0.0',
    nativeBuildVersion: '1',
    platform: { android: { versionCode: 1 } },
    sessionId: 'test-session',
    statusBarHeight: 0,
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

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapViewComponent = ({ children }) => React.createElement(View, null, children);
  return {
    __esModule: true,
    default: MapViewComponent,
    MapView: MapViewComponent,
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

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: jest.fn(() => Promise.resolve({ error: null })),
    presentPaymentSheet: jest.fn(() => Promise.resolve({ error: null })),
    confirmPayment: jest.fn(() => Promise.resolve({ error: null })),
    confirmPaymentMethod: jest.fn(() => Promise.resolve({ error: null })),
    createPaymentMethod: jest.fn(() => Promise.resolve({ error: null })),
    handleNextAction: jest.fn(() => Promise.resolve({ error: null })),
    retrievePaymentIntent: jest.fn(() => Promise.resolve({ error: null })),
  }),
  StripeProvider: ({ children }) => { const R = require('react'); return R.createElement(R.Fragment, null, children); },
  initPaymentSheet: jest.fn(),
  presentPaymentSheet: jest.fn(),
}));

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

jest.mock('@gtaxi/design-system/native', () => {
  const R = require('react');
  const { View, Text } = require('react-native');
  return { LiquidGlass: ({ children }) => R.createElement(View, null, children), Skeleton: () => R.createElement(View, null), Logo: () => R.createElement(Text, null, 'Logo'), LoadingOverlay: 'LoadingOverlay' };
});

jest.mock('./src/context/RideContext', () => ({
  useRide: () => ({ activeRide: null, loading: false, checkActiveRide: jest.fn(), clearActiveRide: jest.fn() }),
  RideProvider: ({ children }) => { const R = require('react'); return R.createElement(R.Fragment, null, children); },
}));

jest.mock('@gtaxi/core', () => {
  const supabaseMock = {
    channel: () => {
      const ch = { on: () => ch, subscribe: jest.fn() };
      return ch;
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: jest.fn(() => Promise.resolve({ data: null })), maybeSingle: jest.fn(() => Promise.resolve({ data: null })), not: () => ({ eq: () => ({ single: jest.fn(() => Promise.resolve({ data: null })) }) }), order: () => ({ limit: () => ({ data: null }) }) }),
        in: () => ({ single: jest.fn(() => Promise.resolve({ data: null })), maybeSingle: jest.fn(() => Promise.resolve({ data: null })), order: () => ({ limit: () => ({ data: null }) }) }),
        order: () => ({ limit: () => ({ data: null }) }),
      }),
      insert: () => ({ select: () => ({ single: jest.fn() }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: jest.fn() }) }) }),
      delete: () => ({ eq: () => ({ select: () => ({ single: jest.fn() }) }) }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'test-user' }, access_token: 'test-token' } }, error: null }),
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null })),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) },
    rpc: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })), single: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
  };
  return {
    supabase: supabaseMock,
    SavedPlace: {},
    Location: {},
    DEFAULT_LOCATION: { latitude: 10.6918, longitude: -61.2225 },
    ENV: { SUPABASE_URL: 'https://test.supabase.co', MAPBOX_PUBLIC_TOKEN: '' },
    initializeSupabaseClient: () => ({ supabase: supabaseMock }),
    haversineMeters: jest.fn(() => 0),
    isWithinRadius: jest.fn(() => true),
    checkGeofenceZone: jest.fn(() => null),
    OutboxService: {
      getInstance: () => ({
        enqueue: jest.fn(),
        process: jest.fn(),
        getPendingCount: jest.fn(() => Promise.resolve(0)),
        clear: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      }),
    },
  };
});

// ---- Stripe (unmocked -> NativeEventEmitter crash on import) ----
jest.mock('@stripe/stripe-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useStripe: () => ({
      initPaymentSheet: jest.fn(() => Promise.resolve({ error: null })),
      presentPaymentSheet: jest.fn(() => Promise.resolve({ error: null })),
      confirmPayment: jest.fn(() => Promise.resolve({ error: null })),
      createPaymentMethod: jest.fn(() => Promise.resolve({ error: null })),
    }),
    useConfirmPayment: () => ({ confirmPayment: jest.fn(() => Promise.resolve({ error: null })), loading: false }),
    StripeProvider: ({ children }) => React.createElement(View, null, children),
    CardField: 'CardField',
    initStripe: jest.fn(),
  };
});

// ---- design-system /native subpath (slash) — screens import LiquidGlass from here ----
jest.mock('@gtaxi/design-system/native', () => {
  const React = require('react');
  const { View, Text, TextInput, Pressable } = require('react-native');
  const Pass = ({ children }) => React.createElement(View, null, children);
  return {
    LiquidGlass: Pass,
    GlassCard: Pass,
    Skeleton: () => React.createElement(View, null),
    Logo: () => React.createElement(View, null, React.createElement(Text, null, 'Logo')),
    WalletCard: () => React.createElement(View, null),
    LoadingOverlay: () => React.createElement(View, null),
    PrimaryButton: Pass,
    InfoChip: Pass,
    StatusBadge: Pass,
    Txt: ({ children }) => React.createElement(Text, null, children),
    // CrystalInput/CrystalButton/RainLogin were missing from this mock, which
    // is why LoginScreen/LegalScreen/RideConfirmationScreen's tests failed
    // with "Element type is invalid: ...got: undefined" — the real components
    // exist and work fine (verified by direct import), Jest just substitutes
    // this mock for the whole module and this mock never had them.
    CrystalInput: (props) => React.createElement(TextInput, {
      testID: props.testID, placeholder: props.placeholder, value: props.value,
      onChangeText: props.onChangeText, secureTextEntry: props.secureTextEntry,
      keyboardType: props.keyboardType,
    }),
    CrystalButton: (props) => React.createElement(
      Pressable, { onPress: props.onPress, disabled: props.disabled || props.loading, testID: props.testID },
      React.createElement(Text, null, props.title)
    ),
    RainLogin: ({ title, subtitle, children, footer }) => React.createElement(
      View, null,
      title ? React.createElement(Text, null, title) : null,
      subtitle ? React.createElement(Text, null, subtitle) : null,
      children, footer,
    ),
    VOICES: { rider: { accent: '#00FFFF' }, driver: { accent: '#00FFFF' }, admin: {}, merchant: {} },
    SURFACE: { base: '#050505', containerLow: '#0A0A0A', containerHigh: '#1A1A1A', containerHighest: '#2A2A2A' },
    ANIMATION: { spring: { damping: 18, stiffness: 150, mass: 1 } },
  };
});

// ---- Complete @gtaxi/core mock (overrides the partial one above) ----
jest.mock('@gtaxi/core', () => {
  const ok = (data = null) => Promise.resolve({ data, error: null });
  // chainable query builder: every filter/modifier returns itself; terminal
  // resolvers (.single/.maybeSingle/await) resolve to { data, error }.
  const builder = {};
  for (const m of ['select','insert','update','delete','upsert','eq','neq','in','not','is',
                   'gte','lte','gt','lt','like','ilike','order','limit','range','filter',
                   'contains','match','or','overlaps']) {
    builder[m] = () => builder;
  }
  builder.single = () => ok(null);
  builder.maybeSingle = () => ok(null);
  builder.then = (cb) => ok([]).then(cb);
  const channelObj = { on: () => channelObj, subscribe: jest.fn(() => channelObj), unsubscribe: jest.fn() };
  const supabaseMock = {
    channel: () => channelObj,
    removeChannel: jest.fn(),
    removeAllChannels: jest.fn(),
    from: () => builder,
    rpc: () => builder,
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
    haversineMeters: jest.fn(() => 0),
    isWithinRadius: jest.fn(() => true),
    checkGeofenceZone: jest.fn(() => null),
    OutboxService: { getInstance: () => ({ enqueue: jest.fn(), process: jest.fn(), getPendingCount: jest.fn(() => Promise.resolve(0)), clear: jest.fn(), start: jest.fn(), stop: jest.fn() }) },
  };
});
