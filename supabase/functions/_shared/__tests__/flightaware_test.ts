// Run: deno test --allow-env supabase/functions/_shared/__tests__/flightaware_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isStale, planPickup, shouldRefresh } from "../flightPickups.ts";
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

Deno.test("codeshare duplicates collapse to the operating flight", () => {
    const raw = { flights: [
        { fa_flight_id: "BWA484-1", ident_iata: "AA7012", operator_iata: "BW", origin: { code_iata: "JFK" }, destination: { code_iata: "POS" }, status: "En Route", scheduled_in: "2026-10-27T03:10:00Z", estimated_in: "2026-10-27T03:30:00Z" },
        { fa_flight_id: "BWA484-1", ident_iata: "BW484", operator_iata: "BW", origin: { code_iata: "JFK" }, destination: { code_iata: "POS" }, status: "En Route", scheduled_in: "2026-10-27T03:10:00Z", estimated_in: "2026-10-27T03:30:00Z", gate_destination: "4" },
    ] };
    const f = pickFlight(raw, "2026-10-26", "POS");
    assertEquals(f?.ident, "BW484");
    assertEquals(f?.gate, "4");
});

Deno.test("an early arrival inside the buffer sends the car now, never in the past", () => {
    const now = Date.parse("2026-10-27T04:00:00Z");
    // Landed 03:00Z, +45 min = 03:45Z, already past at 04:00Z.
    const landed = { ...pickFlight(AERO, "2026-10-26", "POS")!, actual_in: "2026-10-27T03:00:00Z" };
    assertEquals(planPickup({ id: "r", scheduled_for: "2026-10-27T04:50:00Z", metadata: {} }, landed, now), { action: "move", scheduled_for: "2026-10-27T04:00:00.000Z" });
});

Deno.test("cost guard: hourly when far off, every run when close, never after landing", () => {
    const now = Date.parse("2026-10-27T00:00:00Z");
    const far = now + 10 * 3_600_000, near = now + 2 * 3_600_000;
    assertEquals(shouldRefresh(null, far, now), true);
    assertEquals(shouldRefresh({ fetched_at: "2026-10-26T23:30:00Z", actual_in: null }, far, now), false);
    assertEquals(shouldRefresh({ fetched_at: "2026-10-26T22:59:00Z", actual_in: null }, far, now), true);
    assertEquals(shouldRefresh({ fetched_at: "2026-10-26T23:55:00Z", actual_in: null }, near, now), true);
    assertEquals(shouldRefresh({ fetched_at: "2026-10-26T23:55:00Z", actual_in: "2026-10-26T23:40:00Z" }, near, now), false);
});

Deno.test("stale flight data is flagged only when the pickup is close", () => {
    const now = Date.parse("2026-10-27T00:00:00Z");
    assertEquals(isStale("2026-10-26T23:20:00Z", "2026-10-27T00:30:00Z", now), true);
    assertEquals(isStale("2026-10-26T23:50:00Z", "2026-10-27T00:30:00Z", now), false);
    assertEquals(isStale("2026-10-26T20:00:00Z", "2026-10-27T05:00:00Z", now), false);
    assertEquals(isStale(null, "2026-10-27T00:20:00Z", now), true);
});

Deno.test("Trinidad time: a landing typed as 18:40 on 29 Oct is 22:40 UTC", () => {
    assertEquals(new Date(`2026-10-29T18:40:00-04:00`).toISOString(), "2026-10-29T22:40:00.000Z");
});
