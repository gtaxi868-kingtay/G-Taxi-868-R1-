# G-TAXI REPAIR SKILL
# File: .agent/skills/gtaxi-repair/SKILL.md
#
# This file contains step-by-step repair instructions for each phase.
# Read CLAUDE.md first. Then read only the phase you are working on.
# Do not read ahead. Do not combine phases.

---

## HOW TO USE THIS FILE

Before starting any phase:
1. Type /compact to clear context
2. Confirm which phase you are on
3. Read ONLY that phase section below
4. Read the actual files listed in that phase
5. Execute the fix
6. Run the verification command
7. Report what changed

---

## PHASE 1 — ADMIN SECURITY LOCKDOWN

Priority: EXECUTE BEFORE ANYTHING ELSE.
A compromised admin is worse than a broken app.

### Files to read first:
- apps/admin/.env
- apps/admin/src/App.tsx
- apps/admin/src/main.tsx

### Fix 1.1 — Remove service role key from admin frontend

In apps/admin/.env:
  DELETE any line containing: SUPABASE_SERVICE_ROLE_KEY
  DELETE any line containing: SERVICE_ROLE

After deletion, verify no references remain:
  Search entire apps/admin/src/ directory for the string 'service_role'
  If any file references it, remove that reference too.
  The admin app must use ONLY the anon key for its Supabase client.

### Fix 1.2 — Replace admin Supabase client with anon key client

In apps/admin/src/ find where supabaseAdmin or createClient is initialized.
Replace the service role client with an anon key client:

  import { createClient } from '@supabase/supabase-js'

  export const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY   // anon key only
  )

Note: Admin operations that genuinely require elevated access should be
moved to dedicated edge functions that use the service role server-side.

### Fix 1.3 — Add authentication gate to admin dashboard

In apps/admin/src/App.tsx add a session check that fires before any
component renders. The page must not render until:
  a) A valid Supabase session exists
  b) The session user has role === 'admin' in the profiles table

Structure:

  const [authChecked, setAuthChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login'
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (profile?.role !== 'admin') {
        await supabase.auth.signOut()
        window.location.href = '/unauthorized'
        return
      }
      setIsAdmin(true)
      setAuthChecked(true)
    })
  }, [])

  if (!authChecked) return <div>Verifying access...</div>
  if (!isAdmin) return null

  // rest of app renders here

### Fix 1.4 — Create admin login page

Create apps/admin/src/pages/Login.tsx with:
  - Email and password fields
  - Supabase signInWithPassword call
  - On success: redirect to /dashboard
  - On failure: show error message
  - No registration — admin accounts are created manually in Supabase dashboard

### Fix 1.5 — Add role column to profiles table

Run this migration:

  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'
    CHECK (role IN ('user', 'driver', 'admin'));

  CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

Then manually set your account to admin in Supabase SQL editor:
  UPDATE profiles SET role = 'admin' WHERE id = 'YOUR_USER_UUID';

### Verification:
  Open admin URL in an incognito browser window with no session.
  You must see a login screen — not the dashboard.
  grep -r 'service_role' apps/admin/src/ must return zero results.

---

## PHASE 2 — EDGE FUNCTION AUTH HARD LOCK

### Files to read first:
- supabase/functions/accept_ride/index.ts
- supabase/functions/update_driver_location/index.ts
- supabase/functions/_shared/ (check if folder exists)

### Fix 2.1 — Create shared auth middleware

Create supabase/functions/_shared/auth.ts:

  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

  export async function requireAuth(req: Request) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )

    const { data: { user }, error } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )

    if (error || !user) {
      throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      })
    }

    return user
  }

  export async function requireDriver(req: Request, supabaseAdmin: any) {
    const user = await requireAuth(req)

    const { data: driver, error } = await supabaseAdmin
      .from('drivers')
      .select('id, status, is_online')
      .eq('user_id', user.id)
      .single()

    if (error || !driver) {
      throw new Response(JSON.stringify({ error: 'Not a registered driver' }), {
        status: 403, headers: { 'Content-Type': 'application/json' }
      })
    }

    return { user, driver }
  }

### Fix 2.2 — Fix accept_ride

In supabase/functions/accept_ride/index.ts:

  REMOVE: any code that reads driver_id from request body
  REMOVE: any code that uses a client-supplied driver_id

  ADD at top of handler:
    import { requireDriver } from '../_shared/auth.ts'
    const { user, driver } = await requireDriver(req, supabaseAdmin)

  USE driver.id for all database operations.
  USE user.id for any profile lookups.
  NEVER use any value from the request body to identify who the driver is.

### Fix 2.3 — Fix update_driver_location

Apply identical pattern:
  Import requireDriver from shared auth
  Resolve driver from JWT — never from request body
  Only update location for the authenticated driver's own record

### Fix 2.4 — Audit all other edge functions

Check each remaining function for any instance of trusting client-supplied
user IDs, driver IDs, or rider IDs. Apply requireAuth to every function
that performs a write operation.

Functions that MUST verify auth before any write:
  create_ride, accept_ride, cancel_ride, complete_ride,
  update_ride_status, update_driver_location, decline_ride

Functions that may be read-only public:
  estimate_fare, geocode (read-only estimates, no personal data written)

### Verification:
  Send a POST to accept_ride with no Authorization header.
  Must receive 401. Must not process the request.
  Send a POST with a valid rider JWT (not a driver).
  Must receive 403.

---

## PHASE 3 — DATABASE CRASH FIXES

### Files to read first:
- supabase/migrations/ (list all files, read the most recent 5)
- supabase/functions/complete_ride/index.ts
- Search codebase for process_wallet_payment

### Fix 3.1 — Create payment_ledger table

Create new migration file:
  supabase/migrations/[TIMESTAMP]_create_payment_ledger.sql

Contents:

  CREATE TABLE IF NOT EXISTS payment_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id          UUID NOT NULL REFERENCES rides(id),
    user_id          UUID NOT NULL REFERENCES profiles(id),
    amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    currency         TEXT NOT NULL DEFAULT 'TTD',
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','authorized','captured','failed','refunded')),
    provider         TEXT NOT NULL DEFAULT 'wallet'
                       CHECK (provider IN ('wallet','stripe','cash')),
    provider_ref     TEXT,
    stripe_event_id  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE payment_ledger ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Users view own ledger entries" ON payment_ledger
    FOR SELECT USING (auth.uid() = user_id);

  CREATE POLICY "No direct inserts by users" ON payment_ledger
    FOR INSERT WITH CHECK (false);

  CREATE INDEX idx_payment_ledger_ride ON payment_ledger(ride_id);
  CREATE INDEX idx_payment_ledger_user ON payment_ledger(user_id);

### Fix 3.2 — Fix cash ride completion crash

In supabase/functions/complete_ride/index.ts:

  FIND where ride status is set to 'completed'
  ADD the following BEFORE that status update:

    if (ride.payment_method === 'cash') {
      const { error: cashError } = await supabaseAdmin
        .from('rides')
        .update({ cash_confirmed: true })
        .eq('id', rideId)
        .eq('status', 'in_progress')

      if (cashError) {
        return new Response(
          JSON.stringify({ error: 'Failed to confirm cash payment' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

  THEN proceed with the status update to 'completed'.

### Fix 3.3 — Fix wallet race condition

Find the process_wallet_payment RPC or function.
Replace the balance check and deduction with an atomic version:

  CREATE OR REPLACE FUNCTION process_wallet_payment(
    p_user_id UUID,
    p_amount NUMERIC,
    p_ride_id UUID
  ) RETURNS BOOLEAN AS $$
  DECLARE
    v_balance NUMERIC;
  BEGIN
    -- Lock the wallet row for this transaction
    SELECT balance INTO v_balance
    FROM wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
    END IF;

    IF v_balance < p_amount THEN
      RETURN FALSE;
    END IF;

    UPDATE wallets
    SET balance = balance - p_amount
    WHERE user_id = p_user_id;

    INSERT INTO payment_ledger (ride_id, user_id, amount, currency, status, provider)
    VALUES (p_ride_id, p_user_id, p_amount, 'TTD', 'captured', 'wallet');

    RETURN TRUE;
  END;
  $$ LANGUAGE plpgsql;

### Fix 3.4 — Block complete_ride from wrong states

In supabase/functions/complete_ride/index.ts:

  CHANGE the valid previous states check from:
    .in('status', ['assigned', 'arrived', 'in_progress'])
  TO:
    .in('status', ['in_progress'])

  A ride that was never started cannot be completed.

### Verification:
  SELECT * FROM payment_ledger LIMIT 1;
  Must not throw "relation does not exist" error.
  Complete a test cash ride end to end — must not throw Postgres exception.

---

## PHASE 4 — DRIVER APP BUILD ERROR

### Files to read first:
- apps/driver/src/screens/DashboardScreen.tsx (read entire file)

### Fix 4.1 — Remove duplicate imports and declarations

In DashboardScreen.tsx:

  Find the two import lines for Sidebar (approximately lines 12-13).
  Keep exactly one. Delete the duplicate.

  Find the two useState declarations that are identical (approximately lines 41 and 43).
  Keep exactly one. Delete the duplicate.

  Do not change any other code in this file.

### Verification:
  cd apps/driver && npx expo export 2>&1 | grep -i "error"
  Must return zero errors.

---

## PHASE 5 — PUSH NOTIFICATION SYSTEM

### Files to read first:
- apps/driver/src/App.tsx
- apps/driver/src/contexts/AuthContext.tsx
- apps/rider/src/contexts/AuthContext.tsx
- supabase/functions/match_driver/index.ts

### Fix 5.1 — Install dependencies

  cd apps/driver
  npx expo install expo-notifications expo-device expo-background-fetch expo-task-manager

  cd apps/rider
  npx expo install expo-notifications expo-device

### Fix 5.2 — Add push_token columns to database

New migration:

  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS push_token TEXT;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

### Fix 5.3 — Register push token on driver login

In apps/driver/src/contexts/AuthContext.tsx, after successful authentication:

  import * as Notifications from 'expo-notifications'
  import * as Device from 'expo-device'

  async function registerPushToken(userId: string) {
    if (!Device.isDevice) return
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return

    const token = (await Notifications.getExpoPushTokenAsync()).data

    await supabase
      .from('drivers')
      .update({ push_token: token })
      .eq('user_id', userId)
  }

  Call registerPushToken(user.id) after driver session is confirmed.

### Fix 5.4 — Register push token on rider login

Same pattern in apps/rider/src/contexts/AuthContext.tsx.
Store token to profiles.push_token instead of drivers.push_token.

### Fix 5.5 — Send push from match_driver edge function

In supabase/functions/match_driver/index.ts, after a driver is matched:

  Create supabase/functions/_shared/push.ts:

    export async function sendPushNotification(
      pushToken: string,
      title: string,
      body: string,
      data: Record<string, string>
    ) {
      if (!pushToken) return

      const serviceAccountJson = JSON.parse(
        atob(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')!)
      )

      // Get OAuth2 access token for FCM HTTP v1 API
      // Use service account to sign a JWT, exchange for access token
      // Then POST to: https://fcm.googleapis.com/v1/projects/PROJECT_ID/messages:send

      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccountJson.project_id}/messages:send`

      await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token: pushToken,
            notification: { title, body },
            data,
            android: { priority: 'high' },
            apns: { payload: { aps: { contentAvailable: true, sound: 'default' } } }
          }
        })
      })
    }

  In match_driver, after driver assignment:
    await sendPushNotification(
      driver.push_token,
      'New Ride Request',
      'A rider is waiting nearby',
      { type: 'NEW_RIDE_OFFER', ride_id: ride.id }
    )

### Fix 5.6 — iOS background retry registration

In apps/driver/src/App.tsx:

  import * as BackgroundFetch from 'expo-background-fetch'
  import * as TaskManager from 'expo-task-manager'

  const RETRY_TASK = 'OFFLINE_COMPLETION_RETRY'

  TaskManager.defineTask(RETRY_TASK, async () => {
    const pending = await AsyncStorage.getItem('pending_completions')
    if (!pending) return BackgroundFetch.BackgroundFetchResult.NoData
    const completions = JSON.parse(pending)
    const remaining = []
    for (const item of completions) {
      try {
        const res = await fetch(/* complete_ride edge function URL */, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(item)
        })
        if (!res.ok) remaining.push(item)
      } catch {
        remaining.push(item)
      }
    }
    await AsyncStorage.setItem('pending_completions', JSON.stringify(remaining))
    return BackgroundFetch.BackgroundFetchResult.NewData
  })

  await BackgroundFetch.registerTaskAsync(RETRY_TASK, {
    minimumInterval: 30,
    stopOnTerminate: false,
    startOnBoot: true
  })

### Verification:
  Background the driver app on a real device.
  Trigger a test ride offer from your account.
  A push notification must appear on the driver's locked screen.

---

## PHASE 6 — STRIPE PAYMENT INTEGRATION

### Files to read first:
- supabase/functions/complete_ride/index.ts
- apps/rider/src/screens/ (find payment or checkout screen)
- supabase/migrations/ (find wallet and payment_status schema)

### Fix 6.1 — Install Stripe SDK in rider app

  cd apps/rider
  npx expo install @stripe/stripe-react-native

  Wrap your root App component with StripeProvider:
    import { StripeProvider } from '@stripe/stripe-react-native'
    <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY}>

### Fix 6.2 — Create create_payment_intent edge function

Create supabase/functions/create_payment_intent/index.ts:

  import Stripe from 'https://esm.sh/stripe@13'
  import { requireAuth } from '../_shared/auth.ts'

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient()
  })

  Deno.serve(async (req) => {
    const user = await requireAuth(req)
    const { ride_id } = await req.json()

    const { data: ride } = await supabaseAdmin
      .from('rides')
      .select('fare_amount, rider_id')
      .eq('id', ride_id)
      .eq('rider_id', user.id)   // Verify this ride belongs to this user
      .single()

    if (!ride) return new Response('Ride not found', { status: 404 })

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(ride.fare_amount * 100),  // Convert to cents
      currency: 'ttd',
      metadata: { ride_id, user_id: user.id },
      payment_method_types: ['card'],
    })

    // Return ONLY client_secret — never return the full PaymentIntent
    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  })

### Fix 6.3 — Create Stripe webhook handler

Create supabase/functions/stripe_webhook/index.ts:

  import Stripe from 'https://esm.sh/stripe@13'

  Deno.serve(async (req) => {
    const sig = req.headers.get('stripe-signature')
    const rawBody = await req.text()  // MUST be raw — do not parse first

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig!,
        Deno.env.get('STRIPE_WEBHOOK_SECRET')!
      )
    } catch (err) {
      return new Response('Webhook signature verification failed', { status: 400 })
    }

    // Idempotency check — Stripe retries failed webhooks
    const { data: existing } = await supabaseAdmin
      .from('payment_ledger')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle()

    if (existing) {
      return new Response('Already processed', { status: 200 })
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      const { ride_id, user_id } = pi.metadata

      await supabaseAdmin.from('payment_ledger').insert({
        ride_id,
        user_id,
        amount: pi.amount / 100,
        currency: pi.currency.toUpperCase(),
        status: 'captured',
        provider: 'stripe',
        provider_ref: pi.id,
        stripe_event_id: event.id
      })

      await supabaseAdmin
        .from('rides')
        .update({ payment_status: 'captured' })
        .eq('id', ride_id)
    }

    if (event.type === 'payment_intent.payment_failed') {
      // Log failure, do not complete ride, notify rider
      const pi = event.data.object as Stripe.PaymentIntent
      console.error('Payment failed for ride:', pi.metadata.ride_id)
    }

    return new Response('OK', { status: 200 })
  })

### Register webhook in Stripe dashboard:
  URL: https://[your-project-ref].supabase.co/functions/v1/stripe_webhook
  Events: payment_intent.succeeded, payment_intent.payment_failed

### Verification:
  Use Stripe CLI: stripe listen --forward-to [your webhook URL]
  Trigger a test payment in Stripe test mode.
  Verify payment_ledger row is created.
  Verify rides.payment_status updates to 'captured'.

---

## PHASE 7 — RLS AND DATA PRIVACY

### Fix 7.1 — Fix profiles RLS

New migration:

  -- Remove permissive policy
  DROP POLICY IF EXISTS "Public read" ON profiles;
  DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

  -- Own profile only
  CREATE POLICY "Own profile read" ON profiles
    FOR SELECT USING (auth.uid() = id);

  CREATE POLICY "Own profile update" ON profiles
    FOR UPDATE USING (auth.uid() = id);

  -- Driver sees assigned rider
  CREATE POLICY "Driver sees active rider" ON profiles
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM rides
        WHERE rides.driver_id = auth.uid()
        AND rides.rider_id = profiles.id
        AND rides.status IN ('assigned', 'arrived', 'in_progress')
      )
    );

  -- Rider sees assigned driver
  CREATE POLICY "Rider sees active driver" ON profiles
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM rides
        WHERE rides.rider_id = auth.uid()
        AND rides.driver_id = profiles.id
        AND rides.status IN ('assigned', 'arrived', 'in_progress')
      )
    );

### Fix 7.2 — Add ride_events audit table

New migration:

  CREATE TABLE IF NOT EXISTS ride_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id     UUID NOT NULL REFERENCES rides(id),
    event_type  TEXT NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    actor_id    UUID,
    actor_role  TEXT CHECK (actor_role IN ('rider','driver','system','admin')),
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE ride_events ENABLE ROW LEVEL SECURITY;

  -- Append only — no updates or deletes ever
  CREATE POLICY "No updates to ride events" ON ride_events
    FOR UPDATE USING (false);
  CREATE POLICY "No deletes from ride events" ON ride_events
    FOR DELETE USING (false);
  CREATE POLICY "Riders see own ride events" ON ride_events
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_id AND rides.rider_id = auth.uid())
    );
  CREATE POLICY "Drivers see own ride events" ON ride_events
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_id AND rides.driver_id = auth.uid())
    );

  CREATE INDEX idx_ride_events_ride ON ride_events(ride_id);

### Verification:
  As rider user A, query: SELECT * FROM profiles WHERE id = [user B's UUID]
  Must return zero rows.

---

## PHASE 8 — RIDE STATE MACHINE LOCK

### Fix 8.1 — Add missing ride status values

  ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'payment_confirmed';
  ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'closed';

### Fix 8.2 — Enforce strict completion state

Already covered in Phase 3 Fix 3.4.
Verify it is in place: complete_ride only allows 'in_progress' as prior state.

### Fix 8.3 — Log all state transitions to ride_events

In every edge function that changes ride status, add after the update:

  await supabaseAdmin.from('ride_events').insert({
    ride_id: rideId,
    event_type: 'STATUS_CHANGED',
    from_status: previousStatus,
    to_status: newStatus,
    actor_id: user.id,
    actor_role: actorRole,  // 'driver', 'rider', or 'system'
    metadata: { timestamp: new Date().toISOString() }
  })

---

## PHASE 9 — GPS SPOOF DETECTION

### Fix 9.1 — Add validation to update_driver_location

In supabase/functions/update_driver_location/index.ts,
after auth verification, before writing to database:

  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  // Reject poor GPS accuracy
  if (accuracy > 50) {
    return new Response(JSON.stringify({ error: 'Accuracy too low' }), { status: 422 })
  }

  // Reject stale timestamps
  const ageMs = Date.now() - new Date(timestamp).getTime()
  if (ageMs > 20000) {
    return new Response(JSON.stringify({ error: 'Stale location data' }), { status: 422 })
  }

  // Reject impossible speed
  const { data: prev } = await supabaseAdmin
    .from('driver_locations')
    .select('lat, lng, updated_at')
    .eq('driver_id', driver.id)
    .single()

  if (prev) {
    const distKm = haversineKm(prev.lat, prev.lng, lat, lng)
    const timeHrs = (Date.now() - new Date(prev.updated_at).getTime()) / 3600000
    if (timeHrs > 0 && (distKm / timeHrs) > 180) {
      await supabaseAdmin.from('ride_events').insert({
        ride_id: null,
        event_type: 'GPS_SPOOF_SUSPECTED',
        actor_id: driver.id,
        actor_role: 'driver',
        metadata: { speed_kmh: distKm / timeHrs, from: [prev.lat, prev.lng], to: [lat, lng] }
      })
      return new Response(JSON.stringify({ error: 'Location rejected' }), { status: 422 })
    }
  }

---

## PHASE 10 — RATE LIMITING

### Fix 10.1 — Create rate limit infrastructure

New migration:

  CREATE TABLE IF NOT EXISTS rate_limit_log (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID NOT NULL,
    endpoint   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_rate_limit_lookup
    ON rate_limit_log (user_id, endpoint, created_at);

### Fix 10.2 — Create shared rate limit utility

Create supabase/functions/_shared/rateLimit.ts:

  export async function checkRateLimit(
    supabaseAdmin: any,
    userId: string,
    endpoint: string,
    maxPerMinute: number
  ): Promise<void> {
    const windowStart = new Date(Date.now() - 60000).toISOString()

    const { count } = await supabaseAdmin
      .from('rate_limit_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gte('created_at', windowStart)

    if ((count ?? 0) >= maxPerMinute) {
      throw new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    }

    await supabaseAdmin.from('rate_limit_log').insert({
      user_id: userId,
      endpoint
    })
  }

### Fix 10.3 — Apply limits to critical functions

  create_ride:              5 per minute
  accept_ride:              10 per minute
  update_driver_location:   60 per minute

Add to each function after auth verification:
  await checkRateLimit(supabaseAdmin, user.id, 'create_ride', 5)

---

## PHASE 11 — GPS DATA RETENTION

### Fix 11.1 — Enable pg_cron

In Supabase dashboard: Database → Extensions → enable pg_cron

### Fix 11.2 — Schedule GPS purge

  SELECT cron.schedule(
    'purge-old-gps-data',
    '0 3 * * *',
    $$
      DELETE FROM driver_locations
      WHERE updated_at < NOW() - INTERVAL '30 days';

      DELETE FROM rate_limit_log
      WHERE created_at < NOW() - INTERVAL '2 hours';
    $$
  );

---

## PHASE 12 — MONITORING + SENTRY

### Fix 12.1 — Install Sentry in mobile apps

  cd apps/driver && npx expo install @sentry/react-native
  cd apps/rider  && npx expo install @sentry/react-native

In each App.tsx:

  import * as Sentry from '@sentry/react-native'

  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: 0.1,
  })

### Fix 12.2 — Add Sentry to edge functions

In each critical edge function (complete_ride, accept_ride, create_ride):

  import * as Sentry from 'https://deno.land/x/sentry/index.mjs'
  Sentry.init({ dsn: Deno.env.get('SENTRY_DSN') })

  // Wrap handler in try/catch:
  try {
    // ... existing handler code
  } catch (error) {
    Sentry.captureException(error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 })
  }

---

## PHASE 13 — APP STORE SUBMISSION

### iOS — apps/driver/ios/Info.plist and apps/rider/ios/Info.plist

Add these keys:

  <key>NSLocationWhenInUseUsageDescription</key>
  <string>G-Taxi uses your location to show your position to riders and calculate accurate pickup routes.</string>

  <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
  <string>G-Taxi needs background location access to track your position during active trips.</string>

  <key>UIBackgroundModes</key>
  <array>
    <string>location</string>
    <string>fetch</string>
  </array>

### Android — apps/driver/app.json and apps/rider/app.json

In the expo.android section:

  "permissions": [
    "ACCESS_FINE_LOCATION",
    "ACCESS_BACKGROUND_LOCATION",
    "FOREGROUND_SERVICE",
    "RECEIVE_BOOT_COMPLETED"
  ]

### Required before submission:
  - Privacy policy URL must be live and publicly accessible
  - Terms of service URL must be live and publicly accessible
  - Both URLs entered in App Store Connect and Google Play Console
  - Data safety section completed in Google Play Console
  - Privacy nutrition labels completed in App Store Connect

---

## FINAL CERTIFICATION — ALL MUST PASS

Run these checks. If any fail, fix before launch.

  1.  grep -r 'service_role' apps/admin/src/       → zero results
  2.  Open admin URL incognito                       → must see login screen
  3.  POST to accept_ride with no auth header        → must return 401
  4.  SELECT * FROM payment_ledger LIMIT 1           → must not error
  5.  Complete a test cash ride                      → must not crash
  6.  cd apps/driver && npx expo export             → zero build errors
  7.  Background driver app, create test ride        → push notification appears
  8.  Complete test Stripe payment in test mode      → webhook received, ledger written
  9.  Run two simultaneous wallet deductions         → only one succeeds
  10. Verify SUPABASE_DB_URL in edge functions       → must end in :6543
  11. Send 10 rapid create_ride requests             → 429 after 5
  12. Send GPS location 500km from current           → must return 422
  13. Query profiles as user A for user B's data     → must return zero rows
  14. Complete ride, go offline, reconnect           → completion retried, DB updated
  15. Trigger test error in app                      → appears in Sentry dashboard
  16. Complete ride, SELECT * FROM ride_events       → full state history logged
