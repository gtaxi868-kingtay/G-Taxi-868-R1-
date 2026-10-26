// Run: deno test --allow-env supabase/functions/_shared/__tests__/flightaware_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { planPickup } from "../flightPickups.ts";
import { exitBufferMinutes, fetchFlightStatus, normaliseFlightNumber, pickFlight, pickupTimeFor } from "../flightaware.ts";

Deno.test("normaliseFlightNumber cleans what people type", () => {
    assertEquals(normaliseFlightNumber("bw 484"), "BW484");
    assertEquals(normaliseFlightNumber("BW-0484"), "BW484");
    assertEquals(normaliseFlightNumber("AA1301"), "AA1301");
    assertEquals(normaliseFlightNumber("B6 1859"), "B61859");
    assertEquals(normaliseFlightNumber("484"), null);
    assertEquals(normaliseFlightNumber(""), null);
});

const AERO = {
    flights: [
        // Yesterday's BW484 must not be picked for today's pickup.
        { ident_iata: "BW484", origin: { code_iata: "JFK" }, destination: { code_iata: "POS" }, status: "Arrived / Gate Arrival",
          scheduled_in: "2026-10-26T03:10:00Z", estimated_in: "2026-10-26T03:00:00Z", actual_in: "2026-10-26T02:58:00Z" },
        { ident_iata: "BW484", origin: { code_iata: "JFK" }, destination: { code_iata: "POS" }, status: "En Route / Delayed",
          scheduled_in: "2026-10-27T03:10:00Z", estimated_in: "2026-10-27T04:05:00Z", actual_in: null, gate_destination: "6" },
    ],
};

Deno.test("pickFlight chooses the flight landing on that Trinidad date", () => {
    // 2026-10-27T03:10Z is 23:10 on 26 Oct in Trinidad (UTC-4).
    const f = pickFlight(AERO, "2026-10-26", "POS");
    assertEquals(f?.estimated_in, "2026-10-27T04:05:00Z");
    assertEquals(f?.gate, "6");
    assertEquals(f?.status, "En Route / Delayed");
    assertEquals(pickFlight(AERO, "2026-10-26", "TAB"), null);
    assertEquals(pickFlight({}, "2026-10-26"), null);
});

Deno.test("pickup waits for the guest to clear the airport", () => {
    assertEquals(exitBufferMinutes("JFK", "POS"), 45);
    assertEquals(exitBufferMinutes("POS", "TAB"), 15);
    const f = pickFlight(AERO, "2026-10-26", "POS")!;
    // estimated 04:05Z + 45 min
    assertEquals(pickupTimeFor(f), "2026-10-27T04:50:00.000Z");
    assertEquals(pickupTimeFor({ ...f, actual_in: "2026-10-27T03:55:00Z" }), "2026-10-27T04:40:00.000Z");
});

Deno.test("without the key, lookups report not configured instead of failing", async () => {
    Deno.env.delete("FLIGHTAWARE_AEROAPI_KEY");
    assertEquals(await fetchFlightStatus("BW484", "2026-10-26"), { configured: false });
});


Deno.test("planPickup moves a pickup only when the arrival really moved", () => {
    const f = pickFlight(AERO, "2026-10-26", "POS")!; // pickup 04:50Z
    assertEquals(planPickup({ id: "r", scheduled_for: "2026-10-27T03:55:00Z", metadata: {} }, f), { action: "move", scheduled_for: "2026-10-27T04:50:00.000Z" });
    assertEquals(planPickup({ id: "r", scheduled_for: "2026-10-27T04:48:00Z", metadata: {} }, f), { action: "keep" });
    assertEquals(planPickup({ id: "r", scheduled_for: "2026-10-27T04:00:00Z", metadata: {} }, { ...f, cancelled: true }), { action: "flag", reason: "cancelled" });
});
