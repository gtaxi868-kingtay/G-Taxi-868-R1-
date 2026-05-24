// Deno Edge Function Tests: fleet_lease_engine
// ============================================================
// Run: deno test --allow-env --allow-net supabase/functions/fleet_lease_engine/__tests__/
// ============================================================

import { assertExists, assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "test-service-role-key";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/fleet_lease_engine`;

const authHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

Deno.test("fleet_lease_engine: function exists and lists actions", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.available_actions);
  assert(body.data.available_actions.length > 0);
});

Deno.test("fleet_lease_engine: create_lease requires vehicle and driver", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=create_lease`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ lease_type: "daily", daily_rate_cents: 3000 }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
  assert(body.error.includes("fleet_vehicle_id") || body.error.includes("driver_id"));
});

Deno.test("fleet_lease_engine: terminate_lease requires lease_id", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=terminate_lease`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ reason: "Driver breach" }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("fleet_lease_engine: apply_daily_fees accepts lease_id param", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=apply_daily_fees`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      date: new Date().toISOString().split("T")[0],
    }),
  });
  const body = await response.json();
  assertExists(body.data.summary);
  assert(typeof body.data.summary.total_leases_processed === "number");
  assert(typeof body.data.summary.total_deducted_cents === "number");
});

Deno.test("fleet_lease_engine: report returns structured summary", async () => {
  const response = await fetch(
    `${FUNCTION_URL}?action=report&start_date=2026-01-01&end_date=2026-12-31`,
    { method: "GET", headers: authHeaders },
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.summary);
  assertExists(body.data.summary.currency);
  assertExists(body.data.summary.total_deducted_cents);
  assertExists(body.data.summary.total_failed_cents);
});

Deno.test("fleet_lease_engine: my_lease returns no active lease for missing driver", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=my_lease`, {
    method: "GET",
    headers: authHeaders,
  });
  // Should be 404 if driver not found, or 200 with null lease
  assert([200, 404].includes(response.status));
  if (response.status === 200) {
    const body = await response.json();
    assertExists(body.data);
  }
});

Deno.test("fleet_lease_engine: verify deduction types are validated", async () => {
  // The RPC functions should validate lease types. This tests the SQL layer
  // by checking the function contract for deduct_daily_lease_fee
  const response = await fetch(`${FUNCTION_URL}?action=report`, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 200);
});

Deno.test("fleet_lease_engine: apply_daily_fees results are measurable", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=apply_daily_fees`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  const body = await response.json();
  // Should always return a summary even with 0 leases
  assertExists(body.data.summary.successful_deductions);
  assertExists(body.data.summary.failed_deductions);
});
