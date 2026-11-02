import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

// Each type of business gets the app its day needs: what the second tab is, what
// the third tab is called, and which extras it shows. The list follows what is
// actually open in Trinidad and Tobago: the place data is food and drink first,
// then groceries, health, retail, hardware, auto, beauty and stays.
export type BusinessTypeKey =
    | 'food' | 'drinks' | 'grocery' | 'health' | 'retail' | 'hardware'
    | 'auto' | 'beauty' | 'stays' | 'laundry' | 'services';

export type WorkRoute = 'Orders' | 'Appointments' | 'PropertyManagement';

export type BusinessType = {
    key: BusinessTypeKey;
    label: string;
    examples: string;
    icon: IconName;
    work: { route: WorkRoute; label: string; icon: IconName; empty: string };
    catalog: { label: string; icon: IconName; addLabel: string } | null;
    bookings: boolean;
    dispatchLabel: string;
};

const orders = (empty: string) => ({ route: 'Orders' as const, label: 'Orders', icon: 'receipt-outline' as IconName, empty });
const bookings = (label: string, empty: string) => ({ route: 'Appointments' as const, label, icon: 'calendar-outline' as IconName, empty });

export const BUSINESS_TYPES: BusinessType[] = [
    { key: 'food', label: 'Food', examples: 'Restaurants, doubles, roti, bakeries, cafes', icon: 'restaurant-outline', work: orders('No orders waiting'), catalog: { label: 'Menu', icon: 'book-outline', addLabel: 'Add a dish' }, bookings: false, dispatchLabel: 'Send a car for a customer' },
    { key: 'drinks', label: 'Bars & parlours', examples: 'Bars, lounges, rum shops, parlours', icon: 'wine-outline', work: orders('No orders waiting'), catalog: { label: 'Drinks', icon: 'beer-outline', addLabel: 'Add a drink' }, bookings: false, dispatchLabel: 'Get a customer home safe' },
    { key: 'grocery', label: 'Groceries', examples: 'Supermarkets, mini marts, fruit, butchers', icon: 'basket-outline', work: orders('No orders waiting'), catalog: { label: 'Products', icon: 'pricetags-outline', addLabel: 'Add a product' }, bookings: false, dispatchLabel: 'Send a car with a shopper' },
    { key: 'health', label: 'Health', examples: 'Pharmacies, clinics, dentists, opticians', icon: 'medkit-outline', work: orders('No orders waiting'), catalog: { label: 'Products', icon: 'pricetags-outline', addLabel: 'Add a product' }, bookings: true, dispatchLabel: 'Send a car for a patient' },
    { key: 'retail', label: 'Retail', examples: 'Clothes, phones, gifts, flowers, furniture', icon: 'shirt-outline', work: orders('No orders waiting'), catalog: { label: 'Products', icon: 'pricetags-outline', addLabel: 'Add a product' }, bookings: false, dispatchLabel: 'Send a car for a customer' },
    { key: 'hardware', label: 'Hardware', examples: 'Hardware, paint, building supplies', icon: 'hammer-outline', work: orders('No orders waiting'), catalog: { label: 'Products', icon: 'pricetags-outline', addLabel: 'Add a product' }, bookings: false, dispatchLabel: 'Send a car for a customer' },
    { key: 'auto', label: 'Auto', examples: 'Mechanics, parts, tyres, car wash', icon: 'car-sport-outline', work: bookings('Jobs', 'No jobs booked today'), catalog: { label: 'Services', icon: 'construct-outline', addLabel: 'Add a service or part' }, bookings: true, dispatchLabel: 'Get a customer home while you work' },
    { key: 'beauty', label: 'Beauty', examples: 'Barbers, salons, nails, spas', icon: 'cut-outline', work: bookings('Bookings', 'No bookings today'), catalog: { label: 'Services', icon: 'sparkles-outline', addLabel: 'Add a service' }, bookings: true, dispatchLabel: 'Send a car for a client' },
    { key: 'stays', label: 'Stays', examples: 'Hotels, guest houses, villas', icon: 'bed-outline', work: { route: 'PropertyManagement', label: 'Rooms', icon: 'bed-outline', empty: 'Add your rooms and nightly rates' }, catalog: null, bookings: false, dispatchLabel: 'Book a ride for a guest' },
    { key: 'laundry', label: 'Laundry', examples: 'Wash and fold, dry cleaning', icon: 'water-outline', work: orders('No pickups waiting'), catalog: { label: 'Prices', icon: 'pricetags-outline', addLabel: 'Add a price' }, bookings: false, dispatchLabel: 'Send a car for a customer' },
    { key: 'services', label: 'Other services', examples: 'Offices, tutors, gyms, anything else', icon: 'briefcase-outline', work: bookings('Bookings', 'No bookings today'), catalog: { label: 'Services', icon: 'list-outline', addLabel: 'Add a service' }, bookings: true, dispatchLabel: 'Send a car for a client' },
];

const FROM_CATEGORY: Record<string, BusinessTypeKey> = {
    grocery: 'grocery', laundry: 'laundry', pharmacy: 'health', hotel: 'stays',
    restaurant: 'food', indian: 'food', chinese: 'food', american: 'food', pizza: 'food',
    seafood: 'food', bakery: 'food', creole: 'food', barber: 'beauty', salon: 'beauty',
    carwash: 'auto', airline: 'services', logistics_hub: 'services',
};

// The owner's choice wins. 'local' tells us nothing, so that owner gets asked.
export function businessTypeFor(m: { business_type?: string | null; category?: string | null } | null): BusinessType | null {
    if (!m) return null;
    const key = m.business_type ?? (m.category ? FROM_CATEGORY[m.category] : undefined);
    return BUSINESS_TYPES.find((t) => t.key === key) ?? null;
}
