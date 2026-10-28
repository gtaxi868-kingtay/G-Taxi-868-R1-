// Run: deno test supabase/functions/_shared/__tests__/hotelRates_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { bestRate, extractRateCandidates, htmlToText, isSafePublicUrl } from "../hotelRates.ts";

Deno.test("only public web addresses are fetched", () => {
    assertEquals(!!isSafePublicUrl("https://www.blueharbour.tt/rates"), true);
    assertEquals(!!isSafePublicUrl("http://guesthouse.com"), true);
    for (const bad of ["ftp://x.com", "https://127.0.0.1/", "http://localhost/", "https://10.0.0.5/x", "https://[::1]/",
        "https://router.local/", "https://x.com:8080/", "https://user:pw@x.com/", "https://abc.supabase.co/functions/v1/admin", "not a url"]) {
        assertEquals(isSafePublicUrl(bad), null, bad);
    }
});

Deno.test("picks the nightly room rate, not taxes or deposits", () => {
    const text = htmlToText(`<html><body><script>var p="$9"</script>
      <h2>Deluxe Ocean Room</h2><p>Rates from TT$1,250 per night</p>
      <p>Deposit TT$500 required. Breakfast TT$95. Airport transfer TT$350.</p></body></html>`);
    const best = bestRate(text);
    assertEquals(best?.rate_cents, 125000);
    assertEquals(best?.currency, "TTD");
    assertEquals(best?.amount_text, "TT$1,250");
});

Deno.test("US dollar prices are labelled, never converted", () => {
    const best = bestRate("Garden Suite US$185 / night, taxes extra");
    assertEquals(best?.currency, "USD");
    assertEquals(best?.rate_cents, 18500);
});

Deno.test("a bare $ is kept as unknown currency", () => {
    const best = bestRate("Standard room $650 per night");
    assertEquals(best?.currency, null);
    assertEquals(best?.rate_cents, 65000);
});

Deno.test("no rate-like words means no suggestion", () => {
    assertEquals(bestRate("Call us on 868-555-1234. Est. 1998. Rooms available."), null);
    assertEquals(extractRateCandidates("Save $20 off your stay").length, 0);
});
