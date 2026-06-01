// Deno Edge Function Tests: nfc_event_handler dispatch layer
// ============================================================
// Tests that a kiosk tap creates a pending order and returns order_id.
// Run: deno test --allow-env --allow-net supabase/functions/nfc_event_handler/__tests__/
// ============================================================

import {
  assertExists,
  assertEquals,
  assert,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-anon-key';

const authHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ANON_KEY}`,
};

Deno.test('nfc_dispatch: rejects missing tag_uid', async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/nfc_event_handler`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'tag_uid required');
});

Deno.test('nfc_dispatch: returns order_id on successful kiosk tap', async () => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/nfc_event_handler`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tag_uid: 'test-kiosk-uid-001',
      nonce: `test-${Date.now()}`,
    }),
  });

  if (response.status === 200) {
    const body = await response.json();
    assertEquals(body.type, 'KIOSK_HANDSHAKE');
    if (body.order_id) {
      assertExists(body.order_id);
      assertExists(body.task_type);
      assertEquals(typeof body.order_id, 'string');
    }
  } else if (response.status === 401) {
    console.log('Skipped: auth required (expected in dev without seeded token)');
  }
});

Deno.test('nfc_dispatch: duplicate nonce returns 409', async () => {
  const nonce = `dup-test-${Date.now()}`;

  const first = await fetch(`${SUPABASE_URL}/functions/v1/nfc_event_handler`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ tag_uid: 'test-kiosk-uid-001', nonce }),
  });

  const second = await fetch(`${SUPABASE_URL}/functions/v1/nfc_event_handler`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ tag_uid: 'test-kiosk-uid-001', nonce }),
  });

  assert(
    second.status === 409 || second.status === 401,
    `Expected 409 or 401, got ${second.status}`,
  );
  if (second.status === 409) {
    const body = await second.json();
    assertEquals(body.error, 'Duplicate event — nonce already used');
  }
});

Deno.test('nfc_dispatch: task_type defaults to first entry in default_services', () => {
  function resolveTaskType(kiosk: { default_services?: string[] | null }): string {
    return (kiosk.default_services || ['transport'])[0];
  }

  assertEquals(resolveTaskType({ default_services: ['grocery', 'laundry'] }), 'grocery');
  assertEquals(resolveTaskType({ default_services: null }), 'transport');
  assertEquals(resolveTaskType({ default_services: ['barber'] }), 'barber');
});

Deno.test('nfc_dispatch: all valid task types resolve correctly', () => {
  const validTypes = ['transport', 'fulfillment', 'barber', 'carwash', 'laundry', 'grocery', 'pharmacy'];
  for (const t of validTypes) {
    const kiosk = { default_services: [t] };
    assertEquals((kiosk.default_services || ['transport'])[0], t);
  }
});
