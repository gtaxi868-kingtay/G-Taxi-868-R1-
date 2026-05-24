// Deno Edge Function Tests: dealer_brokerage
// ============================================================
// Run: deno test --allow-env --allow-net supabase/functions/dealer_brokerage/__tests__/
// ============================================================

import { assertExists, assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "test-anon-key";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "test-service-role-key";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/dealer_brokerage`;

const corsHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
};

function createTestVehicle(overrides = {}): Record<string, unknown> {
  return {
    dealer_id: "00000000-0000-0000-0000-000000000000",
    make: "Toyota",
    model: "Corolla",
    year: 2024,
    vehicle_type: "standard",
    price_cents: 12000000, // $120,000 TTD
    ...overrides,
  };
}

function createTestLead(overrides = {}): Record<string, unknown> {
  return {
    vehicle_id: "00000000-0000-0000-0000-000000000000",
    notes: "Driver interested in financing",
    ...overrides,
  };
}

Deno.test("dealer_brokerage: function exists and responds", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: corsHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.available_actions);
  assert(body.data.available_actions.length > 0);
});

Deno.test("dealer_brokerage: list_vehicles returns array", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=list_vehicles`, {
    method: "GET",
    headers: corsHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.vehicles);
  assert(Array.isArray(body.data.vehicles));
});

Deno.test("dealer_brokerage: create_lead requires vehicle_id", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=create_lead`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({}),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
  assert(body.error.includes("vehicle_id"));
});

Deno.test("dealer_brokerage: create_lead verifies vehicle exists", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=create_lead`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify(createTestLead({ vehicle_id: "00000000-0000-0000-0000-000000000001" })),
  });
  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("dealer_brokerage: update_lead_status validates status", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=update_lead_status`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({
      sale_id: "00000000-0000-0000-0000-000000000000",
      status: "invalid_status",
    }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("dealer_brokerage: report returns structured data", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=report&start_date=2026-01-01&end_date=2026-12-31`, {
    method: "GET",
    headers: corsHeaders,
  });
  const body = await response.json();
  assertExists(body.data.summary);
  assertExists(body.data.summary.total_brokerage_fees_cents);
  assertExists(body.data.summary.currency);
});

Deno.test("dealer_brokerage: list_dealers returns active dealers", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=list_dealers`, {
    method: "GET",
    headers: corsHeaders,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.data.dealers);
  assert(Array.isArray(body.data.dealers));
});

Deno.test("dealer_brokerage: update_lead_status requires sale_id", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=update_lead_status`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({ status: "financing_pending" }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("dealer_brokerage: create_dealer requires fields", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=dealer`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({ commission_type: "percentage", commission_value: 2.5 }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});

Deno.test("dealer_brokerage: create_vehicle validates required fields", async () => {
  const response = await fetch(`${FUNCTION_URL}?action=vehicle`, {
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({ make: "Toyota" }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.success, false);
});
