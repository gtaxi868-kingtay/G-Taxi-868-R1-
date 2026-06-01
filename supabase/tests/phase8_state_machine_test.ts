// Phase 8 — Ride State Machine Integration Tests
// Run: deno test --allow-net --allow-env supabase/tests/phase8_state_machine_test.ts
//
// These tests verify the database-level state machine trigger enforces
// all valid and invalid ride status transitions correctly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helpers
async function createTestRide(initialStatus = "requested"): Promise<any> {
  const { data, error } = await admin
    .from("rides")
    .insert({
      status: initialStatus,
      pickup_lat: 10.5,
      pickup_lng: -61.4,
      dropoff_lat: 10.6,
      dropoff_lng: -61.5,
      pickup_address: "Test Pickup",
      dropoff_address: "Test Dropoff",
      payment_method: "cash",
      payment_status: "pending",
      rider_id: "00000000-0000-0000-0000-000000000000",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test ride: ${error.message}`);
  }
  return data;
}

async function cleanupRide(id: string): Promise<void> {
  await admin.from("rides").delete().eq("id", id);
}

async function assertTransition(
  rideId: string,
  newStatus: string,
  shouldSucceed: boolean,
  extraFields: Record<string, unknown> = {}
): Promise<void> {
  const update: Record<string, unknown> = { status: newStatus, ...extraFields };
  const { error } = await admin.from("rides").update(update).eq("id", rideId);

  if (shouldSucceed && error) {
    throw new Error(
      `Expected transition TO '${newStatus}' to succeed but got error: ${error.message}`
    );
  }
  if (!shouldSucceed && !error) {
    throw new Error(
      `Expected transition TO '${newStatus}' to FAIL but it succeeded`
    );
  }
}

type Transition = {
  from: string;
  to: string;
  shouldSucceed: boolean;
  extra?: Record<string, unknown>;
};

// ── Test Suite ─────────────────────────────────────────────────────────────

Deno.test("State Machine: happy path full flow", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "cash",
    });
    await assertTransition(ride.id, "payment_confirmed", true, {
      payment_status: "captured",
    });
    await assertTransition(ride.id, "closed", true);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: rider cancellation flow", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "cancelled", true);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: cannot change completed ride", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "cash",
    });
    // Any transition from completed should fail (except terminal flow)
    await assertTransition(ride.id, "assigned", false);
    await assertTransition(ride.id, "in_progress", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: cannot change cancelled ride", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "cancelled", true);
    await assertTransition(ride.id, "assigned", false);
    await assertTransition(ride.id, "in_progress", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: cannot complete without fare", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    // Should fail — no total_fare_cents set
    await assertTransition(ride.id, "completed", false, {
      payment_method: "cash",
    });
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: card requires captured payment", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    // Should fail — card needs payment_status = 'captured'
    await assertTransition(ride.id, "completed", false, {
      total_fare_cents: 5000,
      payment_method: "card",
      payment_status: "pending",
    });
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: card with captured payment succeeds", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "card",
      payment_status: "captured",
    });
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: illegal transitions fail", async () => {
  const ride = await createTestRide("requested");
  try {
    // Can't skip states
    await assertTransition(ride.id, "in_progress", false);
    await assertTransition(ride.id, "completed", false);
    await assertTransition(ride.id, "arrived", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: waiting_queue flow", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "waiting_queue", true);
    await assertTransition(ride.id, "searching", true);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: expired then re-search", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "expired", true);
    await assertTransition(ride.id, "searching", true);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: payment_confirmed needs captured/confirmed payment", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "cash",
    });
    // Should fail — payment_status is 'pending', not 'captured' or 'confirmed'
    await assertTransition(ride.id, "payment_confirmed", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: payment_confirmed with captured payment succeeds", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "card",
      payment_status: "captured",
    });
    await assertTransition(ride.id, "payment_confirmed", true, {
      payment_status: "captured",
    });
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: closed is terminal", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "cash",
    });
    await assertTransition(ride.id, "payment_confirmed", true, {
      payment_status: "captured",
    });
    await assertTransition(ride.id, "closed", true);
    // Closed is terminal — nothing can change it
    await assertTransition(ride.id, "cancelled", false);
    await assertTransition(ride.id, "completed", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: scheduled can go to searching", async () => {
  const ride = await createTestRide("scheduled");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "cancelled", true);
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: total_fare_check constraint", async () => {
  const ride = await createTestRide("requested");
  try {
    // Negative fare should be rejected
    const { error } = await admin
      .from("rides")
      .update({ total_fare_cents: -100 })
      .eq("id", ride.id);
    if (!error) {
      throw new Error("Expected negative total_fare_cents to be rejected");
    }
  } finally {
    await cleanupRide(ride.id);
  }
});

// ── Admin Cancel Ride Tests (via direct DB to check trigger) ──────────────

Deno.test("State Machine: admin can cancel non-terminal rides", async () => {
  const ride = await createTestRide("requested");
  try {
    // Direct DB update simulating admin cancel
    const { error } = await admin
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Admin override",
      })
      .eq("id", ride.id)
      .in("status", [
        "requested", "searching", "waiting_queue", "expired",
        "assigned", "arrived", "scheduled",
      ]);
    if (error) {
      throw new Error(`Admin cancel should succeed: ${error.message}`);
    }
  } finally {
    await cleanupRide(ride.id);
  }
});

Deno.test("State Machine: admin cannot cancel completed ride", async () => {
  const ride = await createTestRide("requested");
  try {
    await assertTransition(ride.id, "searching", true);
    await assertTransition(ride.id, "assigned", true);
    await assertTransition(ride.id, "arrived", true);
    await assertTransition(ride.id, "in_progress", true);
    await assertTransition(ride.id, "completed", true, {
      total_fare_cents: 5000,
      payment_method: "cash",
    });
    // Should fail — completed is terminal
    await assertTransition(ride.id, "cancelled", false);
  } finally {
    await cleanupRide(ride.id);
  }
});

console.log("All state machine tests defined. Run with: deno test --allow-net --allow-env");
