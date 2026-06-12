export interface RideData {
  id: string;
  status: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  total_fare_cents?: number | null;
  driver_payout_cents?: number | null;
  payment_method?: string | null;
  arrived_at?: string | null;
  order_id?: string | null;
  entertainment_url?: string | null;
  entertainment_status?: string | null;
  route_geometry?: string | null;
}

export interface RiderData {
  id?: string;
  name?: string;
  full_name?: string;
  phone_number?: string;
  raw_user_meta_data?: { name?: string };
}

export interface LocationData {
  coords?: {
    latitude: number;
    longitude: number;
    speed?: number | null;
    heading?: number | null;
    accuracy?: number | null;
  };
}

export interface StopData {
  id: string;
  lat: number;
  lng: number;
  stop_order: number;
  status: string;
  place_name?: string;
  stop_type?: string;
}

export interface NavigationAndStatusControlProps {
  ride: RideData;
  rider?: RiderData | null;
  location?: LocationData | null;
  signalStatus?: string;
  stops?: StopData[];
  orderItems?: { product_name: string; quantity: number }[];
  isQuietRide?: boolean;
  hasMerchantPhoto?: boolean;
  routeCoords?: { latitude: number; longitude: number }[];
  onArrived?: () => void;
  onVerifyPickup?: () => void;
  onComplete?: () => void;
  onCancel?: () => void;
  onSOS?: () => void;
  onOpenNavigation?: () => void;
  onChat?: () => void;
  onCall?: () => void;
  onDeliveryConfirmPickup?: () => void;
  onEntertainmentAccept?: () => void;
  onEntertainmentReject?: () => void;
}
