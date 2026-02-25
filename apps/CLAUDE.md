# G-TAXI — CLAUDE CODE CONTEXT
# Read this entire file before touching any code.
# Do not skip sections. Do not assume you know the state of any file.
# Do not fix multiple phases in one session unless explicitly told to.

---

## WHAT THIS SYSTEM IS

A production ride-hailing platform for Trinidad and Tobago.

Components:
- Rider mobile app:    apps/rider/         (Expo/React Native/TypeScript)
- Driver mobile app:   apps/driver/        (Expo/React Native/TypeScript)
- Admin dashboard:     apps/admin/         (Vite/React/TypeScript)
- Edge functions:      supabase/functions/ (Deno/TypeScript — 13 functions)
- Database:            Supabase Postgres with PostGIS, RLS enabled, 27 migrations
- Maps:                Mapbox
- Auth:                Supabase Auth (email/password)
- Realtime:            Supabase Realtime WebSocket subscriptions

---

## PRODUCTION STATUS

  PRODUCTION READY:        NO
  SAFE FOR PUBLIC LAUNCH:  NO
  Security confidence:     8%
  Payment readiness:       5%
  System completeness:     32%

---

## ABSOLUTE RULES — NEVER VIOLATE THESE

1. SUPABASE_SERVICE_ROLE_KEY must NEVER exist in:
   - apps/admin/src/ (any file)
   - apps/rider/ (any file)
   - apps/driver/ (any file)
   - Any file that gets bundled into a client JS bundle
   It belongs ONLY in Supabase Edge Function environment secrets.

2. Edge functions must NEVER trust client-supplied IDs.
   Always resolve identity from the JWT via auth.getUser().
   Required pattern for every edge function:

     const authHeader = req.headers.get('Authorization')
     const { data: { user }, error } = await supabaseClient.auth.getUser(
       authHeader?.replace('Bearer ', '')
     )
     if (error || !user) {
       return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
     }

3. Database connections from edge functions must use transaction mode pooler.
   Port 6543 — NOT port 5432.
   Direct connections (5432) will exhaust under concurrent load and crash everything.

4. Wallet deductions must use SELECT FOR UPDATE inside explicit BEGIN/COMMIT.
   Never check balance and deduct in separate unguarded statements.

5. Stripe webhook handlers must verify signature using the RAW request body.
   Call req.text() before any JSON parsing. Never parse first.

6. Stripe secret key and webhook secret go ONLY in Supabase edge function secrets.
   Never in any app .env or frontend file under any circumstance.

7. Do not change ride state machine transitions without reading
   the full state machine section below first.

8. Do not modify RLS policies without reading the RLS section below first.

9. Every output must be a complete file — never a partial snippet.
   No "// rest of code unchanged" comments. The whole file, always.

---

## KNOWN CRASHES — FIRE ON EVERY RIDE COMPLETION TODAY

### Crash 1: Missing payment_ledger table
  Trigger:  auto_insert_ledger_on_completion
  Problem:  References payment_ledger table that does not exist
  Result:   Postgres exception on every single ride completion
  Fix:      Phase 3

### Crash 2: Cash ride completion crash
  Trigger:  check_payment_completion_safety
  Problem:  Requires cash_confirmed = TRUE but complete_ride never sets it
  Result:   Postgres exception on every cash ride completion
  Fix:      Phase 3

### Crash 3: Driver app will not compile
  File:     apps/driver/src/screens/DashboardScreen.tsx
  Problem:  Duplicate Sidebar import on lines 12-13
            Duplicate useState declaration on lines 41 and 43
  Result:   Build failure — nothing ships
  Fix:      Phase 4

---

## KNOWN SECURITY HOLES — ALL CRITICAL

### Hole 1: Service role key in admin client bundle
  File:    apps/admin/.env
  Risk:    Anyone with browser devtools gets full unrestricted database access
  Fix:     Phase 1

### Hole 2: accept_ride trusts client-supplied driver_id
  File:    supabase/functions/accept_ride/index.ts
  Risk:    Anyone can accept any ride as any driver
  Fix:     Phase 2

### Hole 3: update_driver_location has no auth check
  File:    supabase/functions/update_driver_location/index.ts
  Risk:    Anyone can move any driver to any GPS position
  Fix:     Phase 2

### Hole 4: Admin dashboard is a public webpage
  File:    apps/admin/src/App.tsx
  Risk:    No login required — full admin access to anyone who finds the URL
  Fix:     Phase 1

### Hole 5: profiles table is world-readable
  Risk:    Any rider can query any other user's name, email, phone number
  Fix:     Phase 7

---

## TECH STACK

### Mobile Apps
  Framework:      Expo SDK, React Native, TypeScript
  Navigation:     React Navigation
  State:          React Context (RideContext, AuthContext, DriverContext)
  Maps:           react-native-maps + Mapbox
  Location:       expo-location
  Storage:        AsyncStorage
  Push:           NOT INTEGRATED — needs expo-notifications + Firebase FCM
  Payments:       NOT INTEGRATED — needs @stripe/stripe-react-native

### Admin Dashboard
  Framework:      Vite + React + TypeScript
  Auth:           MISSING — must add Supabase Auth gate
  Current bug:    Service role key in client bundle — remove immediately

### Edge Functions
  Runtime:        Deno
  Functions:      create_ride, accept_ride, cancel_ride, complete_ride,
                  match_driver, estimate_fare, update_ride_status,
                  expire_offer, decline_ride, get_active_ride,
                  update_driver_location, geocode, auto-match-bot
  Shared folder:  supabase/functions/_shared/
                  Create shared utilities here — auth.ts, rateLimit.ts, push.ts

### Database
  Provider:       Supabase Postgres + PostGIS
  Extensions:     PostGIS (required), pg_cron (add for scheduled jobs)
  Connection:     MUST use transaction mode pooler port 6543 for all edge functions
  RLS:            Enabled on all tables
  Migrations:     supabase/migrations/ — 27 applied, more needed

---

## RIDE STATE MACHINE

Correct flow:
  searching → assigned → arrived → in_progress → completed → payment_confirmed → closed

Critical rules:
  - complete_ride must ONLY allow transition from 'in_progress'
    Currently broken: also allows from 'assigned' — driver can skip the entire trip
  - State transitions enforced via .in('status', validStates) in edge functions
  - Client must never set ride status directly — always call an edge function
  - Add missing states: payment_confirmed, closed

Payment state flow on rides.payment_status:
  pending → authorized → captured → confirmed → receipt_sent

---

## RLS RULES

profiles table — correct policy:
  - User can read and write their OWN profile only
  - Driver can read profile of their CURRENTLY ASSIGNED rider only
    (rides.driver_id = auth.uid() AND rides.status IN ('assigned','arrived','in_progress'))
  - Rider can read profile of their CURRENTLY ASSIGNED driver only
    (rides.rider_id = auth.uid() AND rides.status IN ('assigned','arrived','in_progress'))
  - No other cross-user profile reads permitted

ride_events table — append only:
  - No UPDATE policy
  - No DELETE policy
  - SELECT: own rides only (riders/drivers), all rides (admin role)

payment_ledger table — read only for users:
  - SELECT: own records only
  - INSERT: edge functions via service role only
  - No UPDATE, no DELETE

---

## ENVIRONMENT FILES — EXACT CONTENTS

### apps/rider/.env
  EXPO_PUBLIC_SUPABASE_URL=
  EXPO_PUBLIC_SUPABASE_ANON_KEY=
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=
  EXPO_PUBLIC_SENTRY_DSN=

### apps/driver/.env
  EXPO_PUBLIC_SUPABASE_URL=
  EXPO_PUBLIC_SUPABASE_ANON_KEY=
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
  EXPO_PUBLIC_SENTRY_DSN=

### apps/admin/.env
  VITE_SUPABASE_URL=
  VITE_SUPABASE_ANON_KEY=
  # SERVICE ROLE KEY DOES NOT BELONG HERE — REMOVED

### Supabase Edge Function Secrets (set in dashboard, never in any file)
  SUPABASE_SERVICE_ROLE_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  FIREBASE_SERVICE_ACCOUNT_JSON   ← base64 encoded JSON
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PROXY_SERVICE_SID
  SENTRY_DSN

---

## EXTERNAL SERVICE LINKS

  Stripe dashboard:       https://dashboard.stripe.com/register
  Stripe API keys:        https://dashboard.stripe.com/apikeys
  Stripe webhooks:        https://dashboard.stripe.com/webhooks
  Firebase console:       https://console.firebase.google.com
  Mapbox signup:          https://account.mapbox.com/auth/signup/
  Twilio signup:          https://www.twilio.com/try-twilio
  Twilio Proxy:           https://www.twilio.com/console/proxy
  Sentry signup:          https://sentry.io/signup/
  Supabase dashboard:     https://supabase.com/dashboard

---

## REPAIR PHASE ORDER

Complete phases in order. Do not skip. Do not combine.
Full instructions for each phase: .agent/skills/gtaxi-repair/SKILL.md

  Phase 1:  Admin security lockdown         (MOST URGENT)
  Phase 2:  Edge function auth lock         (MOST URGENT)
  Phase 3:  Database crash fixes            (MOST URGENT)
  Phase 4:  Driver app build error          (BLOCKER)
  Phase 5:  Push notifications              (Firebase FCM)
  Phase 6:  Stripe payment integration
  Phase 7:  RLS and data privacy
  Phase 8:  Ride state machine lock
  Phase 9:  GPS spoof detection
  Phase 10: Rate limiting
  Phase 11: GPS data retention + pg_cron
  Phase 12: Monitoring + Sentry
  Phase 13: App store submission prep

---

## SESSION RULES FOR CLAUDE CODE

- Run /compact before starting each new phase
- Read the actual file before changing it — never assume its contents
- Only touch files within the scope of the current phase
- Output complete files only — no partial snippets
- After each file change, state what verification command confirms it worked
- If you encounter an error you cannot resolve, stop and report it clearly
  Do not attempt to work around errors silently
