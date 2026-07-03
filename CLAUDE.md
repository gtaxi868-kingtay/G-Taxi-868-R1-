# G-TAXI — CLAUDE CODE CONTEXT
# Read this entire file before touching any code.
# Do not skip sections. Do not assume you know the state of any file.
# Do not fix multiple phases in one session unless explicitly told to.

# Last updated: 2026-06-13
# Plain English summary (based on code in this repo):
# This repository implements a two-sided ride-hailing system for Trinidad
# and Tobago: a Rider app, a Driver app, an Admin dashboard, and Supabase
# backend code (database + edge functions). The mobile apps are Expo SDK
# projects (Expo 52) and target Android/APKs via EAS; iOS prebuilds require
# Xcode/CocoaPods on macOS.

# IMPORTANT: The prior CLAUDE.md (dated 2026-05-16) listed 5 crashes and 5
# security holes. Every single one has been verified as FIXED in the source
# code as of 2026-05-30. Read the actual file before repeating stale claims.

---

## WHAT THIS SYSTEM IS

A production ride-hailing platform for Trinidad and Tobago.

Components:
- Rider mobile app:    apps/rider/         (Expo/React Native/TypeScript)
- Driver mobile app:   apps/driver/        (Expo/React Native/TypeScript)
- Admin dashboard:     apps/admin/         (Vite/React/TypeScript)
- Edge functions:      supabase/functions/ (Deno/TypeScript — 23 functions)
- Database:            Supabase Postgres with PostGIS, RLS enabled, 30+ migrations
- Maps:                Mapbox
- Auth:                Supabase Auth (email/password)
- Realtime:            Supabase Realtime WebSocket subscriptions

---

## PRODUCTION STATUS (verified 2026-05-30 — prior CLAUDE.md was 14 days stale)

  PRODUCTION READY:        NO  (secrets not configured in Supabase project)
  SAFE FOR PUBLIC LAUNCH:  NO  (secrets not configured in Supabase project)
  Security confidence:     85% (all Phase 1-3, 7-8 holes fixed in code)
  Payment readiness:       75% (SDK wired, webhook done, publishable key set)
  System completeness:     75% (all phases have code — some need env config)

---

## PREVIOUSLY LISTED CRASHES — ALL VERIFIED AS FIXED

These were listed as active crashes in the prior CLAUDE.md. Every one has been
confirmed resolved by reading the actual source code on 2026-05-30.

  Crash 1 (payment_ledger trigger):  FIXED — table exists, Phase 3 migration
                                     corrected column names in the trigger
  Crash 2 (cash_confirmed):          FIXED — complete_ride/index.ts:241
                                     sets cash_confirmed: true before status change
  Crash 3 (driver app compile):      FIXED — no duplicate Sidebar import (line 24
                                     is the only one), no duplicate useState (lines
                                     55-66 are all unique)

## PREVIOUSLY LISTED HOLES — ALL VERIFIED AS FIXED

  Hole 1 (service role key):             FIXED — admin/.env has no service key.
                                          Only VITE_SUPABASE_URL and VITE_ANON_KEY.
  Hole 2 (accept_ride client driver_id): FIXED — uses requireDriver() resolving
                                          from JWT. No driver_id in request body.
  Hole 3 (update_driver_location auth):  FIXED — uses requireDriver() at line 49.
                                          GPS spoof detection also implemented.
  Hole 4 (admin no auth):                FIXED — AdminSecurityGate component at
                                          App.tsx:18 checks session + admin role.
  Hole 5 (profiles world-readable):      FIXED — Phase 7 RLS cleanup dropped the
                                          "Public read profiles" policy. Current:
                                          own profile, driver-sees-rider, rider-sees-driver.

---

## EDGE FUNCTION SECRETS — STATUS AS OF 2026-06-13

  SET IN SUPABASE DASHBOARD (confirmed 2026-06-13):
  - FIREBASE_SERVICE_ACCOUNT_JSON  ✅ SET — base64 encoded service account for g-taxi-868-584a4
  - GROQ_API_KEY                   ✅ SET — llama-3.3-70b-versatile (unblocks ai-gateway + platform_intelligence)

  AUTO-INJECTED BY SUPABASE RUNTIME (never set manually — always available):
  - SUPABASE_SERVICE_ROLE_KEY      ✅ AUTO — Supabase injects this into every edge function
  - SUPABASE_URL                   ✅ AUTO — same
  - SUPABASE_ANON_KEY              ✅ AUTO — same
  Note: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") always resolves in deployed functions.
  Do NOT add it to dashboard secrets — the runtime provides it. Do NOT put it in any
  client-side bundle (absolute rule 1 still applies to the CLIENT apps).

  NOT YET SET — will crash on first invocation:
  - STRIPE_SECRET_KEY              ❌ CRITICAL — all card payments fail
  - STRIPE_WEBHOOK_SECRET          ❌ CRITICAL — webhook signature verify fails (stripe_webhook:61)
  - WHATSAPP_PHONE_NUMBER_ID / TOKEN ⚠️ WhatsApp falls back to wa.me deep links
  - WIPAY_ACCOUNT_NUMBER / API_KEY ❌ Card payments via WiPay return coming_soon
  - UPSTASH_REDIS_REST_URL / TOKEN ❌ Redis cache fails (non-fatal)
  - SENTRY_DSN                     ❌ Error reporting silent (non-fatal)

## DEPLOYED EDGE FUNCTIONS — STATUS AS OF 2026-06-13

  NEWLY DEPLOYED (2026-06-13):
  - platform_intelligence  — AI agent using Groq llama-3.3-70b; verify_jwt: false (cron-callable)
  - submit_dispute         — Rider/driver dispute filing; verify_jwt: true
  - admin_process_payout   — Admin payout approve/reject; verify_jwt: true

  DEPLOYED (2026-06-16):
  - estimate_fare    v41   — fixed missing PRICING import (was crashing on every success path);
                             now reads live rates from pricing_config table, falls back to hardcoded
  - admin_assign_driver v31 — inlined auth, verify_jwt set to true (was false)

  DEPLOYED (2026-06-17) — travel flow fixes:
  - book_travel_package v10 — fixed airport transfer pickup coords (was defaulting to Piarco Airport
                              as BOTH pickup AND dropoff when rider had no home address saved; now
                              defaults to Port of Spain city centre 10.6549,-61.5019); added booking
                              confirmation push notification immediately after successful booking
  - platform_intelligence v8 — added deterministic pre-steps before AI loop:
                                (1) activateScheduledTransfers: transitions rides with status='scheduled'
                                    to 'searching' 45 min before scheduled_for, pushes rider to notify
                                (2) sendTravelReminders: sends 48h and 24h departure push reminders for
                                    confirmed travel_bookings; deduped via agent_decision_log sentinel

  DEPLOYED (2026-06-17) — G-Escape flight-anchored model:
  - book_escape v1 — atomic seat hold via secure_escape_booking() FOR UPDATE; Stripe pre-auth
                     with capture_method='manual' (never auto-charges); wallet path via
                     capture_escape_wallet_payment() FOR UPDATE; rollback via
                     release_single_reservation() on any downstream failure; idempotent
                     (returns existing ACTIVE_HOLD on retry instead of double-booking)

  DB MIGRATION APPLIED (2026-06-17): gescape_flight_anchored_model
  - New tables: driver_zone_rates (12 TTD zones seeded), flight_blocks (POOLING/CONFIRMED/CANCELLED),
                lodging_nodes, escape_packages (margin_positive constraint), package_reservations
  - New RPCs: secure_escape_booking (pessimistic FOR UPDATE seat lock),
              release_expired_holds (pg_cron every minute),
              release_single_reservation (immediate error-path rollback),
              capture_escape_wallet_payment (SELECT FOR UPDATE on wallet),
              check_flight_tipping_points (daily: CONFIRM or CANCEL blocks past deadline),
              admin_upsert_escape_package
  - pg_cron: release-expired-escape-holds (every minute), check-escape-tipping-points (6am daily)

  DB MIGRATION APPLIED (2026-06-16): pricing_config_and_admin_rpcs
  - New table: pricing_config (key, value_cents, description) seeded with TTD fare constants
  - New RPCs: admin_get_pricing, admin_set_pricing, admin_get_surge_zones,
              admin_deactivate_surge_zone, admin_create_surge_zone
  - All 5 RPCs were missing — admin Pricing page errored on every load before this

## GENUINE REMAINING GAPS (verified against source code 2026-06-13, corrected 2026-06-13)

1. STRIPE KEYS NOT SET — blocks all card payments
   STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET both required.

3. MOBILE APPS NEVER BUILT — no APK/IPA for distribution
   EAS config is in place (apps/rider/eas.json). Run:
     cd apps/rider && eas build --profile preview --platform android
     cd apps/driver && eas build --profile preview --platform android
     cd apps/merchant-mobile && eas build --profile preview --platform android

4. RIDER APP CONFIG — expo-notifications ALREADY PRESENT
   apps/rider/app.config.js line 103 already includes "expo-notifications".
   CLAUDE.md previously said it was missing — that claim was stale.

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

## RIDE STATE MACHINE

Correct flow:
  searching → assigned → arrived → in_progress → completed → payment_confirmed → closed

Current enforcement:
  - complete_ride blocks non-in_progress (index.ts:162 + line 328 .in("in_progress"))
  - State transitions enforced via .in('status', validStates) in edge functions
  - Client must never set ride status directly — always call an edge function

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
  - Verified: Phase 7 migrations dropped the world-readable "Public read profiles" policy

ride_events table — append only:
  - No UPDATE policy
  - No DELETE policy
  - SELECT: own rides only (riders/drivers), all rides (admin role through edge functions)

payment_ledger table — read only for users:
  - SELECT: own records only
  - INSERT: edge functions via service role only
  - No UPDATE, no DELETE

---

## ENVIRONMENT FILES — EXACT CONTENTS

### apps/rider/.env
  EXPO_PUBLIC_SUPABASE_URL=https://ffbbuafgeypvkpcuvdnv.supabase.co
  EXPO_PUBLIC_SUPABASE_ANON_KEY=<set>
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=<set — pk_test_...>
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=<set>
  (Sentry DSN not set)

### apps/driver/.env
  EXPO_PUBLIC_SUPABASE_URL=<same>
  EXPO_PUBLIC_SUPABASE_ANON_KEY=<same>
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=<same>
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=<same>

### apps/admin/.env
  VITE_SUPABASE_URL=<same>
  VITE_SUPABASE_ANON_KEY=<same>
  # Service role key NOT present — confirmed clean

### Supabase Edge Function Secrets (must be set in dashboard)
  SUPABASE_SERVICE_ROLE_KEY       ← SET THIS FIRST
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  FIREBASE_SERVICE_ACCOUNT_JSON   ← base64 encoded JSON
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PROXY_SERVICE_SID
  SENTRY_DSN
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN

---

## TECH STACK

### Mobile Apps
  Framework:      Expo SDK 52, React Native, TypeScript
  Navigation:     React Navigation
  State:          React Context (RideContext, AuthContext, DriverContext)
  Maps:           react-native-maps + Mapbox
  Location:       expo-location
  Storage:        expo-secure-store (Auth sessions) — packages/core/src/client.ts:17
  Push:           INTEGRATED — expo-notifications + _shared/push.ts (FCM HTTP v1 + Expo fallback)
  Payments:       INTEGRATED — @stripe/stripe-react-native 0.40.0, stripe_webhook verified

### Admin Dashboard
  Framework:      Vite + React + TypeScript
  Auth:           AdminSecurityGate (App.tsx:18) — checks session + admin role via edge function
  Status:         Secure — no service role key in bundle

### Edge Functions
  Runtime:        Deno
  Functions:      23 total including create_ride, accept_ride, cancel_ride,
                  complete_ride, match_driver, estimate_fare, update_ride_status,
                  update_driver_location, nfc_event_handler, nfc_restore_session,
                  stripe_webhook, merchant_dispatch, merchant_gateway, etc.
  Shared:         supabase/functions/_shared/ — auth.ts, rateLimit.ts, push.ts,
                  sentry.ts, redis.ts, fcm.ts

### Database
  Provider:       Supabase Postgres + PostGIS
  Extensions:     PostGIS enabled
  RLS:            Enabled on all tables
  Migrations:     supabase/migrations/ — 30+, all applied

---

## EXTERNAL SERVICE LINKS

  Stripe dashboard:       https://dashboard.stripe.com/register
  Stripe API keys:        https://dashboard.stripe.com/apikeys
  Stripe webhooks:        https://dashboard.stripe.com/webhooks
  Firebase console:       https://console.firebase.google.com
  Mapbox signup:          https://account.mapbox.com/auth/signup/
  Twilio signup:          https://www.twilio.com/try-twilio
  Sentry signup:          https://sentry.io/signup/
  Supabase dashboard:     https://supabase.com/dashboard

---

## SESSION RULES

- Read the actual file before changing it — never assume its contents
- Only touch files within the scope of the current task
- Output complete files only — no partial snippets
- After each file change, state what verification command confirms it worked
- If you encounter an error you cannot resolve, stop and report it clearly
  Do not attempt to work around errors silently

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix) — embedded in local-issue frontmatter. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context repo. CONTEXT-MAP.md at root points to per-context CONTEXT.md files (one per app/backend area). See `docs/agents/domain.md`.
