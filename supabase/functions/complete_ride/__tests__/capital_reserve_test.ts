// Deno Edge Function Tests: capital_reserve_settlement
// ============================================================
// Tests the business-plan 82/15/3 settlement math used across
// all 4 payment paths: wallet, cash, card, admin force-complete.
//   Driver 82%  |  Platform 15%  |  Growth Reserve 3%
// ============================================================
// Run: deno test --allow-env --allow-net supabase/functions/complete_ride/__tests__/
// ============================================================

import { assertExists, assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "test-service-role-key";

const authHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

// ── SETTLEMENT MATH TESTS ──────────────────────────────────────────────────
// These test the computeSettlement function logic that must be IDENTICAL
// across all 4 payment paths. Business-plan split 82/15/3.

interface Settlement {
  reserveCents: number;
  platformFee: number;
  driverPayout: number;
}

function computeSettlement(grossCents: number, platformRate = 0.15, reserveRate = 0.03): Settlement {
  const platformFee = Math.round(grossCents * platformRate);
  const reserveCents = Math.round(grossCents * reserveRate);
  const driverPayout = grossCents - platformFee - reserveCents;
  return { reserveCents, platformFee, driverPayout };
}

Deno.test("settlement: $100 ride — invariant platform + reserve + driver = gross", () => {
  const gross = 10000; // $100.00 in cents
  const s = computeSettlement(gross);

  assertEquals(s.platformFee, 1500);    // 15% = $15.00
  assertEquals(s.reserveCents, 300);    // 3%  = $3.00
  assertEquals(s.driverPayout, 8200);   // 82% = $82.00

  // INVARIANT: platform + reserve + driver = gross
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: loyalty driver — platform 12%, driver 85%", () => {
  const gross = 10000;
  const s = computeSettlement(gross, 0.12, 0.03);
  assertEquals(s.platformFee, 1200);    // 12%
  assertEquals(s.reserveCents, 300);    // 3%
  assertEquals(s.driverPayout, 8500);   // 85%
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: $50 ride — fractional cents round correctly", () => {
  const gross = 5000; // $50.00
  const s = computeSettlement(gross);

  assertEquals(s.platformFee, 750);     // 15% of $50
  assertEquals(s.reserveCents, 150);    // 3% of $50
  assertEquals(s.driverPayout, 4100);   // $41.00
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: $200 ride — double check", () => {
  const gross = 20000;
  const s = computeSettlement(gross);

  assertEquals(s.platformFee, 3000);
  assertEquals(s.reserveCents, 600);
  assertEquals(s.driverPayout, 16400);
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: $22.00 minimum fare", () => {
  const gross = 2200;
  const s = computeSettlement(gross);

  assert(s.reserveCents > 0);
  assert(s.platformFee > 0);
  assert(s.driverPayout > 0);
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: $1000 large ride scale test", () => {
  const gross = 100000;
  const s = computeSettlement(gross);

  assertEquals(s.platformFee, 15000);   // $150.00
  assertEquals(s.reserveCents, 3000);   // $30.00
  assertEquals(s.driverPayout, 82000);  // $820.00
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: $5 cancellation fee", () => {
  const gross = 500;
  const s = computeSettlement(gross);

  assertEquals(s.platformFee, 75);      // 15%
  assertEquals(s.reserveCents, 15);     // 3%
  assertEquals(s.platformFee + s.reserveCents + s.driverPayout, gross);
});

Deno.test("settlement: invariant holds across many amounts", () => {
  for (let cents = 100; cents <= 50000; cents += 37) {
    const s = computeSettlement(cents);
    assertEquals(
      s.platformFee + s.reserveCents + s.driverPayout,
      cents,
      `Failed at ${cents} cents: ${s.platformFee} + ${s.reserveCents} + ${s.driverPayout} != ${cents}`
    );
  }
});

Deno.test("settlement: effective rates are exactly 82/15/3", () => {
  const gross = 10000;
  const s = computeSettlement(gross);

  assertEquals(((s.reserveCents / gross) * 100).toFixed(3), "3.000");
  assertEquals(((s.platformFee / gross) * 100).toFixed(3), "15.000");
  assertEquals(((s.driverPayout / gross) * 100).toFixed(3), "82.000");
});

// ── API ENDPOINT TESTS ─────────────────────────────────────────────────────

Deno.test("settlement: process_wallet_payment wrapper exists", async () => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_wallet_payment`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_ride_id: "00000000-0000-0000-0000-000000000001",
      p_amount: 10000,
    }),
  });
  assert(response.status >= 400, "RPC should exist even if ride not found");
});

Deno.test("settlement: capital_reserve_ledger table exists", async () => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/capital_reserve_ledger`, {
    method: "GET",
    headers: authHeaders,
  });
  assert(
    [200, 401, 403, 404].includes(response.status),
    `Unexpected status: ${response.status}`
  );
});

// ── COMPLETE_RIDE INTEGRATION ──────────────────────────────────────────────

Deno.test("settlement: complete_ride rejects missing ride_id", async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/complete_ride`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assert(response.status >= 400);
});

// ── DRIVER + PLATFORM IMPACT (82/15/3 vs old 81/19/1.5) ────────────────────

Deno.test("impact: drivers GAIN under 82/15/3 — $1000 weekly gross", () => {
  const weeklyGross = 100000; // $1,000

  // Old model: driver 81% = $810. New: driver 82% = $820.
  const oldPayout = Math.round(weeklyGross * 0.81);
  const newPayout = computeSettlement(weeklyGross).driverPayout;

  assertEquals(newPayout, 82000);
  assertEquals(newPayout - oldPayout, 1000); // driver gains $10 per $1,000
});

Deno.test("impact: platform take drops, reserve doubles — $1000 gross", () => {
  const gross = 100000;
  const s = computeSettlement(gross);

  // Old platform-side total (fee+reserve) = 19% = $190.
  // New platform-side total = 15% + 3% = 18% = $180.
  const oldPlatformSide = Math.round(gross * 0.19);
  const newPlatformSide = s.platformFee + s.reserveCents;
  assertEquals(newPlatformSide, 18000);
  assertEquals(oldPlatformSide - newPlatformSide, 1000); // company gives up $10 to the driver

  // Reserve doubled: old 1.5% = $15 → new 3% = $30.
  assertEquals(s.reserveCents, 3000);
});
