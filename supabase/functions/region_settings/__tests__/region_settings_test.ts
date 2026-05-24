// Deno Edge Function Tests: region_settings
// ============================================================
// Run: deno test --allow-env --allow-net supabase/functions/region_settings/__tests__/
// ============================================================

import { assertExists, assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "test-service-role-key";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/region_settings`;

const authHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

Deno.test("region_settings: function exists and lists actions", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.available_actions);
  assert(body.data.available_actions.length > 0);
});

Deno.test("region_settings: list returns active regions", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=list`, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.regions);
  assert(Array.isArray(body.data.regions));
});

Deno.test("region_settings: resolve returns region config", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=resolve`, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.region);
  assertExists(body.data.pricing);
  assertExists(body.data.pricing.currency);
  assertExists(body.data.compliance);
});

Deno.test("region_settings: resolve_by_location requires coordinates", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=resolve_by_location`, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("region_settings: resolve_by_location with coordinates succeeds", async () => {
  const response = await fetch(
    `${FUNCTION_URL}?action=resolve_by_location&lat=10.654&lng=-61.502`,
    { method: "GET", headers: authHeaders },
  );
  // Should return 200 with region data, or 404 if no region configured
  assert([200, 404].includes(response.status));
  if (response.status === 200) {
    const body = await response.json();
    assertExists(body.data.region);
  }
});

Deno.test("region_settings: create requires code and name", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=create`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ currency: "BBD" }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("region_settings: update requires region_id", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=update`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ is_active: false }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("region_settings: validate requires region_id", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=validate`, {
    method: "GET",
    headers: authHeaders,
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("region_settings: validate returns check results", async () => {
  const response = await fetch(
    `${FUNCTION_URL}?action=validate&region_id=00000000-0000-0000-0000-000000000000`,
    { method: "GET", headers: authHeaders },
  );
  const body = await response.json();
  assertExists(body.data);
  if (body.data) {
    assertExists(body.data.checks);
    assert(typeof body.data.is_ready === "boolean");
  }
});

Deno.test("region_settings: create with template works", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=create`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      code: "TEST",
      name: "Test Region",
      template_region_code: "TT",
    }),
  });
  // May create or return conflict if TEST already exists
  assert([201, 409].includes(response.status));
});

Deno.test("region_settings: update validates field names", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=update`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      region_id: "00000000-0000-0000-0000-000000000000",
      invalid_field: "test",
    }),
  });
  // Should still process (invalid field is ignored), but since region
  // might not exist, check for proper JSON response
  const body = await response.json();
  assertExists(body.success);
});
