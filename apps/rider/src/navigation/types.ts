import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
};

export type RideConfirmationParams = {
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
  dropoffLat?: number;
  dropoffLng?: number;
  dropoffAddress?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  estimatedFareCents?: number;
  destination?: { latitude: number; longitude: number; address?: string };
  pickup?: { latitude: number; longitude: number; address?: string };
  source?: string;
  sourceMetadata?: Record<string, any>;
  kioskId?: string;
  taxiStandId?: string;
  editPickupMode?: boolean;
  // A stop chosen before booking; see utils/shopStop.ts.
  stop?: { name: string; latitude: number; longitude: number; address?: string; merchantId?: string; storeType?: string };
};

export type ActiveRideParams = {
  rideId: string;
  destination?: { latitude: number; longitude: number; address: string };
  fare?: any;
  paymentMethod?: string;
};

export type GroceryOrderStatusParams = {
  orderId: string;
  service?: { label?: string };
  weight?: number;
  priceCents?: number;
};

export type ProductListingParams = {
  category: string;
};

export type ProductDetailParams = {
  productId: string;
};

export type ChatParams = {
  rideId?: string;
  userId?: string;
  userName?: string;
  driver?: { name?: string };
};

export type LaundryOrderStatusParams = {
  orderId: string;
};

export type RatingParams = {
  rideId: string;
  driverId?: string;
};

export type DriverFoundParams = {
  driverId: string;
  driverName?: string;
  driverRating?: number;
  vehicle?: string;
  plate?: string;
  rideId: string;
  eta?: number;
  driver?: { name: string; vehicle: string; plate: string; rating: number };
  destination?: { latitude: number; longitude: number; address: string };
  fare?: { distance_meters: number; duration_seconds: number; total_fare_cents: number; route_polyline: string };
};

export type NfcScanParams = {
  nodeId?: string;
  token?: string;
  mode?: 'scan' | 'pay';
};

export type TagMarkerParams = {
  nodeId?: string;
  tagUid?: string;
};

// Params the Map tab (the old Home screen) accepts: QR taxi-stand deep links
// and NFC taps.
export type MapParams = {
  // Text to send straight to G (search could not find it).
  askG?: string;
  lat?: string;
  lng?: string;
  stand?: string;
  source?: string;
  nfcTagId?: string;
  nfcLat?: string;
  nfcLng?: string;
  nfcLocation?: string;
  editPickupMode?: boolean;
};

// The five bottom tabs. They live inside the stack route named "Home", so
// every existing navigate('Home') / reset to 'Home' still lands on the tabs.
export type MainTabParamList = {
  Map: MapParams | undefined;
  Services: undefined;
  Activity: undefined;
  WalletTab: undefined;
  You: undefined;
};

export type AppStackParamList = {
  Home: NavigatorScreenParams<MainTabParamList> | undefined;
  Profile: undefined;
  Notifications: undefined;
  DestinationSearch: {
    currentLocation?: { latitude: number; longitude: number; address?: string };
    source?: string;
    sourceMetadata?: Record<string, any>;
    kioskId?: string;
    taxiStandId?: string;
    editPickupMode?: boolean;
    // Opened from Saved Places "Add new place": picking a result saves it
    // instead of booking a ride.
    saveMode?: boolean;
    // A shop to stop at on the way (Home shop card "Stop on my way").
    stop?: RideConfirmationParams['stop'];
    // Set by PinOnMap: the spot the rider placed by hand.
    pinned?: { latitude: number; longitude: number; address: string };
  };
  PinOnMap: { near?: { latitude: number; longitude: number }; label?: string } | undefined;
  RideConfirmation: RideConfirmationParams;
  RideReview: {
    stops: Array<{ type: 'pickup' | 'stop' | 'dropoff'; address: string; lat: number; lng: number }>;
    service_type: string;
    estimated_fare_cents: number;
    total_duration_seconds: number;
    total_distance_meters: number;
    validation_required: boolean;
    raw_query: string;
  };
  SearchingDriver: {
    rideId: string;
    destination?: { latitude: number; longitude: number; address: string };
    fare?: { total_fare_cents: number };
    pickup?: { latitude: number; longitude: number; address: string };
  };
  ActiveRide: ActiveRideParams;
  Rating: RatingParams;
  Trips: undefined;
  EditProfile: undefined;
  Settings: undefined;
  Payment: undefined;
  Wallet: undefined;
  WalletTopUp: undefined;
  SavedPlaces: undefined;
  Help: undefined;
  Receipt: {
    ride?: {
      id: string;
      created_at: string;
      total_fare_cents: number;
      wait_fare_cents?: number;
      distance_meters: number;
      duration_seconds: number;
      pickup_address: string;
      dropoff_address: string;
      wallet_deduction_cents?: number;
      cash_payment_cents?: number;
      payment_status?: string | null;
      payment_method?: string | null;
    };
    // Preferred. ReceiptScreen always refetches the authoritative row; any
    // `ride` passed above is treated only as a placeholder while that loads.
    rideId?: string;
  };
  ReportProblem: {
    ride?: {
      id: string;
      pickup_address?: string;
      dropoff_address?: string;
      total_fare_cents?: number;
    } | null;
  } | undefined;
  Promo: undefined;
  Chat: ChatParams;
  AISettings: undefined;
  GroceryStorefront: undefined;
  ProductListing: { merchant: { id: string; name: string; category: string; [key: string]: any } };
  ProductDetail: ProductDetailParams;
  GroceryCart: { cart: any[]; merchant: { id: string; name: string; [key: string]: any } };
  GroceryOrderStatus: GroceryOrderStatusParams;
  VisionScanner: undefined;
  LaundryLanding: undefined;
  LaundryEstimator: { service: { id: string; label: string; icon: string; baseRate: number } };
  LaundryOrderStatus: LaundryOrderStatusParams;
  DriverFound: DriverFoundParams;
  NfcHandshake: {
    tagUid?: string;
  };
  NfcScan: NfcScanParams;
  NfcPay: { merchantTagUid: string; merchantName?: string; merchantId?: string };
  TagMarker: TagMarkerParams;
  ServiceBooking: {
    merchantId?: string;
    merchantName?: string;
    kioskNodeId?: string;
    tagUid?: string;
    pickup?: { latitude: number; longitude: number; address: string };
    destination?: { latitude: number; longitude: number; address: string };
  };
  Legal: undefined;
  Subscription: undefined;
  GSpot: undefined;
  Referral: undefined;
  FoodDelivery: undefined;
  EscapeStorefront: { packageId?: string } | undefined;
  EscapeCheckout: { packageId: string; guestCount: number; userLocation: { latitude: number; longitude: number } };
  ActivePass: undefined;
  PassportSubmission: { participantId: string };
  Carnival: undefined;
  Events: undefined;
  CashWithdrawal: undefined;
};

export type RootStackParamList = AppStackParamList;

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;

// Props for a screen shown as a bottom tab: tab navigation plus everything the
// parent stack can do (navigate to any app screen, replace, reset).
export type TabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
