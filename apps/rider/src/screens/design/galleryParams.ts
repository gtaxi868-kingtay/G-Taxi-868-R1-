// Sample route params for the web screen gallery (/design-preview/screens?s=Name).
// Lets every screen render at phone size for a layout check without signing in.
// Data-backed parts show their empty/loading states; that is expected.

const POS = { latitude: 10.6596, longitude: -61.5115, address: 'Woodford Square, Port of Spain' };
const DEST = { latitude: 10.6434, longitude: -61.2852, address: 'Piarco International Airport' };

export const GALLERY_PARAMS: Record<string, any> = {
    Home: {},
    DestinationSearch: { currentLocation: POS },
    RideConfirmation: {
        pickup: POS, destination: DEST,
        pickupLat: POS.latitude, pickupLng: POS.longitude, pickupAddress: POS.address,
        dropoffLat: DEST.latitude, dropoffLng: DEST.longitude, dropoffAddress: DEST.address,
        distanceMeters: 27400, durationSeconds: 1980, estimatedFareCents: 18500,
    },
    RideReview: {
        stops: [
            { type: 'pickup', address: POS.address, lat: POS.latitude, lng: POS.longitude },
            { type: 'dropoff', address: DEST.address, lat: DEST.latitude, lng: DEST.longitude },
        ],
        service_type: 'standard', estimated_fare_cents: 18500, total_duration_seconds: 1980,
        total_distance_meters: 27400, validation_required: false, raw_query: 'airport',
    },
    SearchingDriver: { rideId: '00000000-0000-0000-0000-000000000000', destination: DEST, pickup: POS, fare: { total_fare_cents: 18500 } },
    ActiveRide: { rideId: '00000000-0000-0000-0000-000000000000', destination: DEST },
    Rating: { rideId: '00000000-0000-0000-0000-000000000000' },
    Receipt: {
        ride: {
            id: '00000000-0000-0000-0000-000000000000', created_at: '2026-10-24T18:30:00Z', total_fare_cents: 18500,
            distance_meters: 27400, duration_seconds: 1980, pickup_address: POS.address, dropoff_address: DEST.address,
            payment_method: 'cash', payment_status: 'confirmed',
        },
    },
    ReportProblem: { ride: { id: '00000000-0000-0000-0000-000000000000', pickup_address: POS.address, dropoff_address: DEST.address, total_fare_cents: 18500 } },
    Chat: { rideId: '00000000-0000-0000-0000-000000000000', userName: 'Marcus', driver: { name: 'Marcus' } },
    ProductListing: { merchant: { id: '00000000-0000-0000-0000-000000000000', name: 'Massy Stores', category: 'grocery' } },
    ProductDetail: { productId: '00000000-0000-0000-0000-000000000000' },
    GroceryCart: { cart: [], merchant: { id: '00000000-0000-0000-0000-000000000000', name: 'Massy Stores' } },
    GroceryOrderStatus: { orderId: '00000000-0000-0000-0000-000000000000' },
    LaundryEstimator: { service: { id: 'wash_fold', label: 'Wash & Fold', icon: 'shirt', baseRate: 2500 } },
    LaundryOrderStatus: { orderId: '00000000-0000-0000-0000-000000000000' },
    DriverFound: {
        driverId: '00000000-0000-0000-0000-000000000000', rideId: '00000000-0000-0000-0000-000000000000',
        driverName: 'Marcus', driverRating: 4.9, vehicle: 'Toyota Corolla', plate: 'PDX 4821', eta: 4, destination: DEST,
        driver: { name: 'Marcus Joseph', vehicle: 'Toyota Corolla · Silver', plate: 'PDX 4821', rating: 4.9 },
    },
    NfcHandshake: {},
    NfcScan: { mode: 'scan' },
    NfcPay: { merchantTagUid: 'demo', merchantName: 'Corner Shop' },
    TagMarker: {},
    ServiceBooking: { merchantName: 'Corner Shop', pickup: POS, destination: DEST },
    EscapeCheckout: { packageId: '00000000-0000-0000-0000-000000000000', guestCount: 2, userLocation: POS },
    PassportSubmission: { participantId: '00000000-0000-0000-0000-000000000000' },
};
