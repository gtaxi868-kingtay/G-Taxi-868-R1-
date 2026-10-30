// WhatsApp tap-to-ride flow tests
// Run: deno test --allow-env --allow-net supabase/functions/whatsapp_webhook/__tests__/whatsapp_flow_test.ts
// Deno is not installed in this environment — run in CI.
// ============================================================

import {
    assertEquals,
    assertAlmostEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    parseTapPrefill,
    normalizePhone,
    formatTTD,
    haversineMeters,
    isTerminalState,
} from "../../_shared/whatsapp_flow.ts";
import { calculateFare, PRICING } from "../../_shared/pricing.ts";

// ── parseTapPrefill ─────────────────────────────────────────────────────────

Deno.test("parseTapPrefill: canonical prefill with node UUID", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    assertEquals(parseTapPrefill(`GTAXI TAP ${id}`), id);
});

Deno.test("parseTapPrefill: lowercase + extra spaces tolerated", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    assertEquals(parseTapPrefill(`  gtaxi tap   ${id}  `), id);
});

Deno.test("parseTapPrefill: hyphenated GTAXI tolerated", () => {
    assertEquals(parseTapPrefill("G-TAXI TAP abc-123"), "abc-123");
});

Deno.test("parseTapPrefill: physical tag UID accepted", () => {
    assertEquals(parseTapPrefill("GTAXI TAP TAGUID998877"), "TAGUID998877");
});

Deno.test("parseTapPrefill: junk rejected", () => {
    assertEquals(parseTapPrefill("hello"), null);
    assertEquals(parseTapPrefill("GTAXI TAP"), null);
    assertEquals(parseTapPrefill("GTAXI TAP <id>"), null);
    assertEquals(parseTapPrefill("GTAXI TAP a"), null); // too short
    assertEquals(parseTapPrefill("GTAXI TAP abc; DROP TABLE x"), null);
    assertEquals(parseTapPrefill(""), null);
    assertEquals(parseTapPrefill("UBER TAP 123e4567-e89b-12d3-a456-426614174000"), null);
});

// ── normalizePhone ──────────────────────────────────────────────────────────

Deno.test("normalizePhone: wa_id digits become E.164", () => {
    assertEquals(normalizePhone("18685551234"), "+18685551234");
});

Deno.test("normalizePhone: strips formatting junk", () => {
    assertEquals(normalizePhone("+1 (868) 555-1234"), "+18685551234");
});

Deno.test("normalizePhone: empty in, empty out", () => {
    assertEquals(normalizePhone(""), "");
});

// ── formatTTD ───────────────────────────────────────────────────────────────

Deno.test("formatTTD: whole dollars", () => {
    assertEquals(formatTTD(2200), "TT$22");
    assertEquals(formatTTD(1600), "TT$16");
});

Deno.test("formatTTD: cents shown when needed", () => {
    assertEquals(formatTTD(2250), "TT$22.50");
});

Deno.test("formatTTD: zero-safe", () => {
    assertEquals(formatTTD(0), "TT$0");
});

// ── haversineMeters ─────────────────────────────────────────────────────────

Deno.test("haversineMeters: ~11.1km per 0.1 degree latitude", () => {
    const m = haversineMeters({ lat: 10.65, lng: -61.52 }, { lat: 10.75, lng: -61.52 });
    assertAlmostEquals(m, 11119, 50);
});

Deno.test("haversineMeters: zero for identical points", () => {
    assertEquals(haversineMeters({ lat: 10.65, lng: -61.52 }, { lat: 10.65, lng: -61.52 }), 0);
});

// ── fare math reuse (same constants estimate_fare uses) ─────────────────────

Deno.test("fare math: base 16 / 1.75 per km / 0.95 per min / min 22", () => {
    assertEquals(PRICING.BASE_FARE_CENTS, 1600);
    assertEquals(PRICING.PER_KM_CENTS, 175);
    assertEquals(PRICING.PER_MIN_CENTS, 95);
    assertEquals(PRICING.MIN_FARE_CENTS, 2200);
    // 10 km, 20 min -> 1600 + 1750 + 1900 = 5250
    assertEquals(calculateFare(10000, 1200, "Standard", 1.0, 0), 5250);
});

Deno.test("fare math: minimum fare binds on short trips", () => {
    // 1 km, 2 min -> 1600 + 175 + 190 = 1965 < 2200 -> 2200
    assertEquals(calculateFare(1000, 120, "Standard", 1.0, 0), 2200);
});

// ── terminal states ─────────────────────────────────────────────────────────

Deno.test("isTerminalState: terminal vs live", () => {
    assertEquals(isTerminalState("COMPLETED"), true);
    assertEquals(isTerminalState("APP_INVITE_SENT"), true);
    assertEquals(isTerminalState("CANCELLED"), true);
    assertEquals(isTerminalState("NO_DRIVERS"), true);
    assertEquals(isTerminalState("AWAITING_DESTINATION"), false);
    assertEquals(isTerminalState("DRIVER_SEARCHING"), false);
    assertEquals(isTerminalState("FARE_QUOTED"), false);
});
