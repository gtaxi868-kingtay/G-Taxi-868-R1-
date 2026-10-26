// Booking.com Demand API connector: turns a hotel's live Booking.com price
// into a rate SUGGESTION the hotel accepts or dismisses (never live on its
// own). INACTIVE until G868 is an approved Booking.com partner and the
// founder sets BOOKING_API_KEY + BOOKING_AFFILIATE_ID in Supabase.
//
// CLAIMED, not PROVEN: the request/response shape follows Booking.com's
// published Demand API v3 (POST /accommodations/availability) but has never
// been run against a real key. The parser below is deliberately defensive
// and is the one piece to re-check against the first real response.

const DEMAND_API = "https://demandapi.booking.com/3.1";

export function bookingConfigured(): boolean {
    return !!(Deno.env.get("BOOKING_API_KEY") && Deno.env.get("BOOKING_AFFILIATE_ID"));
}

// Cheapest bookable price found anywhere in the response, as a nightly rate.
// Looks for products[].price.{book,total} (number or {amount}) and the
// response currency; returns null rather than guessing.
export function nightlyRateFromAvailability(raw: any, nights: number): { rate_cents: number; currency: string | null; amount_text: string } | null {
    if (!(nights > 0)) return null;
    const data = raw?.data ?? raw;
    const currency: string | null = (data?.currency ?? raw?.currency ?? null) || null;
    const prices: number[] = [];
    const visit = (node: any, depth: number) => {
        if (!node || typeof node !== "object" || depth > 6) return;
        if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
        const p = node.price;
        if (p && typeof p === "object") {
            for (const k of ["book", "total"]) {
                const v = typeof p[k] === "number" ? p[k] : typeof p[k]?.amount === "number" ? p[k].amount : Number(p[k]?.amount ?? p[k]);
                if (Number.isFinite(v) && v > 0) { prices.push(v); break; }
            }
        }
        for (const key of Object.keys(node)) if (key !== "price") visit(node[key], depth + 1);
    };
    visit(data?.products ?? data, 0);
    if (prices.length === 0) return null;
    const nightly = Math.min(...prices) / nights;
    const rate_cents = Math.round(nightly * 100);
    if (rate_cents <= 0) return null;
    const cur = currency ? currency.toUpperCase() : null;
    return { rate_cents, currency: cur, amount_text: `${cur ?? ""} ${nightly.toFixed(2)} per night (Booking.com)`.trim() };
}

export async function fetchBookingNightlyRate(
    bookingHotelId: string, checkin: string, checkout: string, adults: number,
): Promise<{ ok: true; rate: ReturnType<typeof nightlyRateFromAvailability> } | { ok: false; error: string }> {
    const key = Deno.env.get("BOOKING_API_KEY");
    const affiliate = Deno.env.get("BOOKING_AFFILIATE_ID");
    if (!key || !affiliate) return { ok: false, error: "not_configured" };
    const nights = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000);
    try {
        const res = await fetch(`${DEMAND_API}/accommodations/availability`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "X-Affiliate-Id": affiliate, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                accommodation: Number(bookingHotelId) || bookingHotelId,
                booker: { country: "tt", platform: "desktop" },
                checkin, checkout, currency: "TTD",
                guests: { number_of_adults: Math.max(1, adults), number_of_rooms: 1 },
            }),
            signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401 || res.status === 403) return { ok: false, error: "Booking.com refused the key." };
        if (!res.ok) return { ok: false, error: `Booking.com error ${res.status}.` };
        return { ok: true, rate: nightlyRateFromAvailability(await res.json(), nights) };
    } catch {
        return { ok: false, error: "Could not reach Booking.com." };
    }
}
