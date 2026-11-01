// Run: deno test --allow-env supabase/functions/_shared/__tests__/bookingCom_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { bookingConfigured, fetchBookingNightlyRate, nightlyRateFromAvailability } from "../bookingCom.ts";

Deno.test("cheapest product, as a nightly rate, in the response currency", () => {
    const raw = { data: { id: 123, currency: "TTD", products: [
        { id: "a", price: { book: 3600, total: 3900 } },
        { id: "b", price: { book: { amount: 3300 } } },
    ] } };
    assertEquals(nightlyRateFromAvailability(raw, 3), { rate_cents: 110000, currency: "TTD", amount_text: "TTD 1100.00 per night (Booking.com)" });
});

Deno.test("no prices, or a nonsense stay length, gives no suggestion", () => {
    assertEquals(nightlyRateFromAvailability({ data: { products: [] } }, 2), null);
    assertEquals(nightlyRateFromAvailability({ data: { products: [{ price: { book: 100 } }] } }, 0), null);
    assertEquals(nightlyRateFromAvailability(null, 2), null);
});

Deno.test("switched off until the founder sets both secrets", async () => {
    Deno.env.delete("BOOKING_API_KEY");
    Deno.env.delete("BOOKING_AFFILIATE_ID");
    assertEquals(bookingConfigured(), false);
    assertEquals(await fetchBookingNightlyRate("1", "2026-11-09", "2026-11-12", 2), { ok: false, error: "not_configured" });
});
