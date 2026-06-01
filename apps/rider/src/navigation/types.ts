import type { NativeStackScreenProps } from '@react-navigation/native-stack';

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
  stop?: { name: string; latitude: number; longitude: number };
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
};

export type TagMarkerParams = {
  nodeId?: string;
  tagUid?: string;
};

export type AppStackParamList = {
  Home: {
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
  Profile: undefined;
  DestinationSearch: {
    currentLocation?: { latitude: number; longitude: number; address?: string };
    source?: string;
    sourceMetadata?: Record<string, any>;
    kioskId?: string;
    taxiStandId?: string;
    editPickupMode?: boolean;
  };
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
    };
    rideId?: string;
  };
  Promo: undefined;
  Chat: ChatParams;
  AISettings: undefined;
  Subscription: undefined;
  GroceryStorefront: undefined;
  ProductListing: ProductListingParams;
  ProductDetail: ProductDetailParams;
  GroceryCart: undefined;
  GroceryOrderStatus: GroceryOrderStatusParams;
  VisionScanner: undefined;
  LaundryLanding: undefined;
  LaundryEstimator: undefined;
  LaundryOrderStatus: LaundryOrderStatusParams;
  DriverFound: DriverFoundParams;
  NfcHandshake: {
    tagUid?: string;
  };
  NfcScan: NfcScanParams;
  TagMarker: TagMarkerParams;
  ServiceBooking: {
    merchantId?: string;
    merchantName?: string;
    kioskNodeId?: string;
    tagUid?: string;
    pickup?: { latitude: number; longitude: number; address: string };
  };
  Legal: undefined;
  DeleteAccount: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
