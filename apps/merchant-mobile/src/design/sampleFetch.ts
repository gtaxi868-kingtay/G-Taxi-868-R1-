// Design review only (web, /design-preview): answers the app's requests with
// sample rows so the real screens can be seen without signing in. Must load
// before the Supabase client, which keeps a reference to fetch.
const ON = typeof window !== 'undefined' && window.location?.pathname?.startsWith('/design-preview');

const art = (emoji: string, bg: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="${bg}"/><text x="200" y="250" font-size="170" text-anchor="middle">${emoji}</text></svg>`)}`;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

const ORDERS = [
    { id: 'o1', status: 'pending', created_at: minutesAgo(3), total_cents: 8500, total: 8500, delivery_method: 'food_delivery', payment_status: 'cash_on_delivery' },
    { id: 'o2', status: 'pending', created_at: minutesAgo(6), total_cents: 4200, total: 4200, delivery_method: 'pickup', payment_status: 'captured' },
    { id: 'o3', status: 'preparing', created_at: minutesAgo(18), total_cents: 12600, total: 12600, delivery_method: 'food_delivery', payment_status: 'captured' },
    { id: 'o4', status: 'ready_for_pickup', created_at: minutesAgo(31), total_cents: 3800, total: 3800, delivery_method: 'pickup', payment_status: 'captured' },
    { id: 'o5', status: 'delivered', created_at: minutesAgo(95), total_cents: 6100, total: 6100, delivery_method: 'food_delivery', payment_status: 'captured' },
];
const ITEMS = [
    { order_id: 'o1', quantity: 2, products: { name: 'Buss-up shot with chicken' } },
    { order_id: 'o1', quantity: 1, products: { name: 'Sorrel, large' } },
    { order_id: 'o2', quantity: 3, products: { name: 'Doubles' } },
    { order_id: 'o3', quantity: 2, products: { name: 'Dhalpuri with goat' } },
    { order_id: 'o3', quantity: 2, products: { name: 'Mauby' } },
    { order_id: 'o4', quantity: 1, products: { name: 'Buss-up shot with chicken' } },
    { order_id: 'o5', quantity: 2, products: { name: 'Doubles' } },
];
const PRODUCTS = [
    { id: 'p1', merchant_id: 'm-1', name: 'Buss-up shot with chicken', description: null, price_cents: 4500, is_available: true, category: 'general', image_url: art('🍛', '#6B3A1E'), sort_order: 1 },
    { id: 'p2', merchant_id: 'm-1', name: 'Doubles', description: null, price_cents: 800, is_available: true, category: 'general', image_url: art('🌯', '#7A5A1E'), sort_order: 2 },
    { id: 'p3', merchant_id: 'm-1', name: 'Dhalpuri with goat', description: null, price_cents: 5200, is_available: true, category: 'general', image_url: art('🥘', '#5A2A1E'), sort_order: 3 },
    { id: 'p4', merchant_id: 'm-1', name: 'Sorrel, large', description: null, price_cents: 1500, is_available: false, category: 'beverages', image_url: art('🥤', '#6E1E3A'), sort_order: 4 },
    { id: 'p5', merchant_id: 'm-1', name: 'Mauby', description: null, price_cents: 1200, is_available: true, category: 'beverages', image_url: art('🧋', '#3A2A1E'), sort_order: 5 },
    { id: 'p6', merchant_id: 'm-1', name: 'Pholourie, six', description: null, price_cents: 1000, is_available: true, category: 'general', image_url: art('🧆', '#7A4A1E'), sort_order: 6 },
];
const APPOINTMENTS = [
    { id: 'a1', scheduled_at: new Date(Date.now() + 3600000).toISOString(), status: 'confirmed', merchant_consent_status: 'approved', ride_requested: true, service: { name: 'Fade and beard' } },
    { id: 'a2', scheduled_at: new Date(Date.now() + 7200000).toISOString(), status: 'pending', merchant_consent_status: 'pending', ride_requested: false, service: { name: 'Haircut' } },
];
const PROMOTIONS = [{ id: 'pr1', promotion_type: 'suggested_stop', budget_cents: 50000, spent_cents: 12500, start_date: '2026-11-01', end_date: '2026-11-30', is_active: true }];

const TABLES: Record<string, unknown[]> = {
    merchant_orders: ORDERS, order_items: ITEMS, products: PRODUCTS, merchant_appointments: APPOINTMENTS,
    vendor_commissions: [{ commission_cents: 4250 }], merchants: [{ id: 'm-1' }],
};

function respond(url: string, init?: RequestInit): Response {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (url.includes('/functions/v1/g_rider_concierge')) {
        return new Response(JSON.stringify({ success: true, reply: 'Good day so far. Sixty-one dollars in sales, two orders waiting, and buss-up shot is your best seller. Want to see the orders?', actions: [{ id: 'screen:orders', label: 'Open orders', icon: 'receipt', payload: { type: 'screen', screen: 'orders' } }] }), { headers });
    }
    if (url.includes('/functions/v1/merchant')) {
        const action = init?.body ? JSON.parse(String(init.body)).action : '';
        if (action === 'list_promotions') return new Response(JSON.stringify({ success: true, promotions: PROMOTIONS }), { headers });
        return new Response(JSON.stringify({ success: true, pickups: [], venue: null }), { headers });
    }
    const table = url.match(/\/rest\/v1\/(\w+)/)?.[1] ?? '';
    const rows = TABLES[table] ?? [];
    headers['content-range'] = `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
    const accept = String((init?.headers as Record<string, string> | undefined)?.Accept ?? (init?.headers as Headers | undefined)?.get?.('Accept') ?? '');
    if (init?.method === 'HEAD') return new Response(null, { headers });
    return new Response(JSON.stringify(accept.includes('object') ? rows[0] ?? null : rows), { headers });
}

if (ON) {
    const real = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String((input as Request).url ?? input);
        if (url.includes('.supabase.co')) return respond(url, init);
        return real(input, init);
    }) as typeof fetch;
}
