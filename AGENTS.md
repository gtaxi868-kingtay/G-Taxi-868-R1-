# G-TAXI — Codex CONTEXT
# Read this entire file before touching any code.
# Do not skip sections. Do not assume you know the state of any file.
# Do not fix multiple phases in one session unless explicitly told to.

# Last updated: 2026-07-01
# Plain English summary (based on code in this repo):
# THIS IS NOT JUST A RIDE-HAILING APP. It is a multiplex ecosystem
# connecting riders to drivers, stores, travel, and services through
# a single hub. 7 apps (rider, driver, admin, merchant-web,
# merchant-mobile, admin-mobile, qr-landing), 86 edge functions,
# 151 migrations, 268 RLS policies, 72,518 lines TypeScript.
# The rider's phone is the hub; drivers, merchants, NFC kiosks,
# and voice AI are the touchpoints. Mobile apps are Expo SDK 52
# targeting Android/APKs via EAS; iOS prebuilds require Xcode/CocoaPods.

# IMPORTANT: The prior AGENTS.md (dated 2026-05-16) listed 5 crashes and 5
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

## PRODUCTION STATUS (verified 2026-05-30 — prior AGENTS.md was 14 days stale)

  PRODUCTION READY:        NO  (secrets not configured in Supabase project)
  SAFE FOR PUBLIC LAUNCH:  NO  (secrets not configured in Supabase project)
  Security confidence:     85% (all Phase 1-3, 7-8 holes fixed in code)
  Payment readiness:       75% (SDK wired, webhook done, publishable key set)
  System completeness:     75% (all phases have code — some need env config)

---

## PREVIOUSLY LISTED CRASHES — ALL VERIFIED AS FIXED

These were listed as active crashes in the prior AGENTS.md. Every one has been
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

## GENUINE REMAINING GAPS (verified against source code)

1. SUPABASE EDGE FUNCTION SECRETS NOT CONFIGURED
   These must be set in the Supabase project dashboard. Without them:
   - FIREBASE_SERVICE_ACCOUNT_JSON  → push silently fails (push.ts:134)
   - STRIPE_SECRET_KEY              → webhook signing fails
   - STRIPE_WEBHOOK_SECRET          → webhook signature verify fails (stripe_webhook:61)
   - TWILIO_ACCOUNT_SID / TOKEN     → SMS fails
   - UPSTASH_REDIS_REST_URL / TOKEN → driver Redis cache fails (non-fatal)
   - SENTRY_DSN                     → error reporting fails
   - AMADEUS_API_KEY / AMADEUS_API_SECRET → sync_flight_availability returns 503
   - BOOKING_API_KEY                → sync_lodging_availability returns 503

2. NFC DISPATCH LAYER NOT YET DEPLOYED
   - supabase/migrations/20260530000005_nfc_dispatch_layer.sql — unapplied
   - supabase/functions/nfc_event_handler/index.ts — updated but undeployed
   - packages/core/src/service_bus.ts + apps/merchant-mobile/src/hooks/useTaskListener.ts
     — written but untested in production

3. RIDER APP CONFIG — MISSING expo-notifications PLUGIN
   apps/rider/app.config.js does not list "expo-notifications" in its plugins
   array. apps/driver/app.config.js does (line 72). This affects Android
   notification icon assets but does not break runtime push delivery.

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

---

## SESSION HISTORY

### 2026-06-25 — Progression perks merge: killed paid subscription, single G-Member tier at Level 5

**What we did:**
1. **Killed 3-tier paid subscription (free/plus/pro)** — Removed from DB, replaced with free progression-based perks. Riders earn discount, priority matching, and wait time by riding, not by paying.

2. **Added perks to `progression_config`** — New columns: `discount_percent`, `priority_matching`, `free_wait_minutes`. Each level grants:
   - L2: 5% off, 5min grace
   - L3: 8% off, 8min grace, priority matching
   - L4: 10% off, 10min grace, priority matching
   - L5: 12% off, 12min grace, priority matching

3. **Single paid tier: G-Member (TTD $35/mo)** — Only purchasable at Level 5. Adds 15% off, unlimited priority, 20min wait, no booking fees. One gold card at the top of the ladder, not three tiers everyone ignores.

4. **Rewrote `SubscriptionScreen` → `G-Level`** — Shows a 5-level perk ladder with progress bars, current level badge, and G-Member upgrade card at Level 5. Below Level 5: locked G-Member teaser with "Keep riding to unlock."

5. **Updated `ProfileScreen`** — Subscription card now shows Level + perks (not tier). Stats labels: "Missions" → "Trips", "RANKING" → "Rating", "ENLISTED" → "Member since". Footer: "RIDER COMMAND V3.2 • EMPIRE OS" → "Trinidad & Tobago". "PURGE DATA & IDENTITY" → "Delete Account".

6. **Updated `SettingsScreen`** — "G-TAXI PASS" section replaced with "G-LEVEL" card. No more manual Plus/Pro upgrade buttons. Shows current level + discount + links to G-Level screen.

7. **Updated `get_rider_progress` edge function** — Now returns `perks` object with `discount_percent`, `priority_matching`, `free_wait_minutes`. Respects G-Member overrides.

8. **Updated `calculate_subscription_discount()` SQL function** — Reads level-based discount from `rider_progression.level` + `progression_config.discount_percent`, adds 3% if g_member.

**Database changes:**
- Migration: `20260625000000_progression_perks_single_tier` (applied to production)
- Removed from `subscription_benefits`: plus (TTD $9.99), pro (TTD $19.99)
- Added to `subscription_benefits`: g_member (TTD $35.00)
- Added to `rider_subscription_tier` enum: `g_member`

**Design principle (T&T market):**
- Free to start. Ride to earn. Pay only at Level 5 when convenience is already habit.
- TTD $35/mo = impulse-buy price (~$5 USD). One tier, not three.
- No credit card needed on sign-up. No rider feels blocked.

### 2026-06-28 — Asymmetric lock + zone system + perimeter hardening reconciliation

**What we did this session:**

1. **Phase 1 — Asymmetric lock (pickup zones, 100% open dropoff):**
   - Removed dropoff + stops zone validation from `create_ride` v55 and `estimate_fare` v44.
   - Pickup-only `is_verified_location` check. Error code `UNVERIFIED_PICKUP_ZONE` returned when pickup outside active zone. Deployed.

2. **Phase 2 — `active_zones` polygon table + Sangre Grande seed:**
   - Created `active_zones` table with geography boundary column.
   - Rewrote `is_verified_location` → uses `ST_Intersects` with geography boundaries.
   - Seeded Sangre Grande Alpha Hub polygon. Verified: Sangre Grande passes, Chaguanas/POS blocked.

3. **Phase 3 — `seeded_zones` demand tracker:**
   - `seed_zone()` upsert with 3-decimal coordinate rounding (~110m grid).

4. **Phase 6 — Event-loop seeding wired:**
   - `complete_ride` v58 payload extended with pickup/dropoff coords.
   - `process_event_queue` v3 handler — calls `is_coordinate_inside_active_zones`, seeds if outside, bypasses if inside.

5. **Phase 5 — Settlement grace period deployed:**
   - `settlement_requests` columns: `grace_period_until`, `bank_confirmed_at`, `bank_reference`.
   - `verify_settlement` v2 — conditional credit with 30-min grace status.
   - `process_settlement_grace` v1 sweep function + RPC deployed.
   - WalletScreen OCR wired into both `handleManualDeposit` and `handleSmartAtmDeposit`.

6. **Phase 4 — `parse_receipt` OCR edge function:**
   - Google Cloud Vision API integration (requires `FIREBASE_SERVICE_ACCOUNT_JSON` secret).
   - Extracts amount_cents, reference_token, deposit_date, bank_name. Fallback returns nulls.

7. **DISCOVERED: sovereign_foundation migration collision (June 22):**
   - Pre-existing `sovereign_foundation` migration already had correct `active_zones`, `seeded_zones` (with geography/GiST/ST_DWithin 500m), `is_verified_location` (FAILS CLOSED SECURITY DEFINER), `is_coordinate_inside_active_zones` (SECURITY DEFINER null-safe), `seed_zone` (ST_DWithin 500m clustering), `record_pool_entry` (17% waterfall), `ecosystem_pool_ledger`, `event_queue` — all prior to this session.
   - My June 28 migrations created **3 function overload collisions** that broke the asymmetric lock:
     - `is_verified_location`: 2 overloads (2-param SECURITY DEFINER + 3-param) → Postgres "function not unique" error
     - `seed_zone`: 2 overloads (2-param + 3-param numeric) → same ambiguity
     - `is_coordinate_inside_active_zones`: overwritten — lost SECURITY DEFINER and fail-closed exception handler
   - `.catch(() => ({ data: true }))` in `create_ride`/`estimate_fare` silently swallowed the Postgres error → **asymmetric lock was a no-op**
   - `seeded_zones` schema mismatch: my `approx_lat`/`approx_lng`/`hit_count` vs sovereign's `lat`/`lng`/`location(geography)`/`seed_count`/`territory_name` with GiST spatial index
   - `record_pool_entry` paid 7+4+3+3 = **17% of gross** but platform only collects 15% → 2% overpayment bug

8. **FIXED: Canonical reconciliation — zero overloads, 15% economic model:**
   - Migration `20260628000014_canonical_reconciliation`: Dropped all 6 overloads. Deployed single canonical versions:
     - `is_coordinate_inside_active_zones(lat, lng)` — SECURITY DEFINER, ST_Covers, null-safe
     - `is_verified_location(lat, lng)` — FAILS CLOSED (exception handler returns false)
     - `seed_zone(lat, lng, territory_name)` — ST_DWithin 500m geography clustering
     - `record_pool_entry(...)` — **15% economic model**: platform_fee = ROUND(gross * 0.15); shares carved from 15% slice: commander 26.7% (4% gross), merchant 13.3% (2% gross), referral 13.3% (2% gross), platform keeps remainder. Mathematically incapable of exceeding 15%.
     - `process_settlement_grace` — expanded expired split sessions + settled pool entries sweeper
   - Confirmed zero overloaded versions in DB.

9. **Perimeter audit — 3 CRITICAL auth gaps fixed:**
   - `generate_b2b_invoices`: Had **zero auth** — anyone could trigger Stripe invoicing for all Net-30 merchants. Added `requireAdmin` inline guard, deployed v1.
   - `verify_settlement`: Authenticated but **never checked admin role** — any logged-in user could approve/reject wallet credit settlements. Added `requireAdmin` inline guard, deployed v3.
   - `process_settlement_grace`: Same gap. Added conditional admin check (auth header present → require admin; cron calls bypass). Deployed v2.
   - Found: 6 admin functions (`admin_create_ride`, `admin_force_complete`, etc.) have no local source files — consolidated into `admin/index.ts` which IS guarded.
   - Found: `admin_manage_surge_zones` and `admin_get_pending_drivers` reimplement `requireAdmin` inline instead of importing from shared. Functionally correct but fragile.

10. **Cron schedules added:**
    - `process_event_queue` — jobid 32, every 60 seconds
    - `process_settlement_grace` — jobid 33, every 5 minutes
    - 16 total active cron schedules now

**Key decisions (corrected 2026-06-28):**
- **Asymmetric lock is NOT a wall.** Pickup zone check is a **prioritization engine**: verified riders are never stranded. Inside active zone → priority matching + guaranteed density. Outside active zone → ride proceeds (standard dispatch), coordinate tagged as Demand Signal via `seed_zone`. Only blocks on genuine technical failure (DB down). See `create_ride` v56.
- sovereign's ST_Covers + exception handler pattern is canonical for zone detection.
- 15% platform fee = primary divider. Downstream shares are percentages of the 15% slice, not of gross. System now incapable of overpaying.
- `record_pool_entry` uses remainder math: all four shares sum exactly to platform_fee. No rounding drift.
- `seeded_zones` uses sovereign's geography column with ST_DWithin 500m clustering — superior to coordinate rounding.
- `.catch(() => ({ data: true }))` was already fixed in prior session (now `{ data: false }`).
- Inlined auth guards to avoid Supabase deploy bundler's `_shared/` import path issues.

### 2026-06-16 — Council audit fixes (pre-commit bugfixes)

**Council findings and fixes this session:**

1. **`get_home_suggestion` RPC wired into HomeScreen** — Was 0 references in app code despite RPC existing in DB. Now called during `fetchEnabledVerticals`, result used as dynamic search placeholder on the Ride layer card. Falls back to "Where to?" if RPC unavailable.

2. **PromoScreen now actually INSERTs into `user_promos`** — Before: showed Alert but never wrote to the table, so promo had no effect and the notification trigger never fired. Now properly inserts + claims with duplicate detection.

3. **Promo notification trigger applied** — `trg_emit_promo_notification` on `user_promos` INSERT fires `notify_user()` with 'promo' type. Trigger-based like the ride/escape notifications.

4. **Rider subscription UI built** — `SubscriptionScreen.tsx` shows 3 tiers (free/plus/pro) with benefit comparison, monthly/yearly pricing, upgrade buttons. Adds "Subscription" to ProfileScreen menu. Tier changes update `profiles.subscription_tier` directly (Stripe billing TBD).

5. **`.gitignore` updated** — added `_agents/`, `superpowers`, `ui-ux-pro-max-skill` patterns to prevent agent skill files from being tracked.

6. **`expo-notifications` plugin** — confirmed already present in rider app.config.js (line 103). Council was working from stale AGENTS.md.

7. **FoodDelivery/EscapeStorefront screens** — confirmed already registered in navigation at commit `5f87c65a`.

**Still requires dashboard config (not code):**
- Edge function secrets (STRIPE_SECRET_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, TWILIO_*, SENTRY_DSN, etc.) — 0 of 10 set
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on `spatial_ref_sys`, `agent_decision_log`, `dispatch_queue`

### 2026-06-15 — Full ecosystem audit + merchant service gap analysis

**What we did this session:**

1. **Full app inventory & build check**: Verified all 7 apps (rider, driver, admin, merchant-web, merchant-mobile, admin-mobile, qr-landing) typecheck/build clean. 72,518 total lines TypeScript, 86 edge functions, 151 migrations, 268 RLS policies.

2. **Fixed actual code bug**: `ProductCatalog` screen was registered at `merchant-mobile/src/screens/ProductCatalog.tsx:57` but **never added** to the `RootStackParamList` type or the main navigator. Rider would tap a product → `TypeError: undefined is not a function`. See `merchant-mobile/src/navigation/AppNavigator.tsx:34` (was missing entry). Fixed.

3. **Ecosystem scope corrected** (mid-session): The user corrected that this isn't just a ride-hailing app. It's a **multiplex ecosystem** connecting riders to drivers, stores, travel, and services through a single hub. Inventory of all 10 verticals: ride-hailing (always on), grocery (L2), laundry (L3), g-wallet (L4), g-escape/travel (L5), merchant delivery (toggle), b2b logistics (toggle), food delivery (toggle), travel packages (toggle), property booking (toggle).

4. **Screen parity audit**: 9 of 50 rider screens at FULL HomeScreen standard. Travel/G-Escape/Referral screens at low parity — untouched by Sprint 1.

**Key discoveries (gaps):**

| Gap | Status | Location |
|-----|--------|----------|
| 19% platform rate hardcoded | **FIXED** — reads from pricing_config table | `complete_ride/index.ts:226`, `create_ride/index.ts`, `admin_force_complete/index.ts` |
| Cold start: 5 edge calls + 4 DB queries + 1 sub before usable | **FIXED** — removed 100ms delay, parallelized profile+prefs, removed duplicate get_active_ride | `RideContext.tsx:83`, `AuthContext.tsx:88-118`, `HomeScreen.tsx:124-143` |
| Cash operations need real infrastructure | Ops/business issue — code done | `complete_ride/index.ts:241` |
| Food delivery blocked | **FIXED** — constraint now allows restaurant/barber/salon/carwash | `20260403000002_unified_handshake_expansion.sql` |
| Barber/salon only stubs | **FIXED** — constraint allows them; ServiceBookingScreen exists; category constraint updated | `suggest_stops/index.ts:82` |
| Appointments half-built | Deferred — needs merchant edge functions | `ServiceBookingScreen.tsx`, `20260406000000_merchant_service_verticals.sql` |
| NFC dispatch migration unapplied | **FIXED** — migration 20260530000005 applied to production | `supabase/migrations/20260530000005_nfc_dispatch_layer.sql` |

**New feature added (2026-06-15):**
- **Merchant Pin System** — Admin can pin/unpin merchants (`is_pinned` on merchants table). Pinned merchants appear first on map (ORDER BY is_pinned DESC). pin_fee_cents on merchant_subscriptions charged on top of monthly fee. Admin UI in MerchantNetwork.tsx with Pin/Unpin toggle + Pin Fee setter + pinned filter chip + Star badge.

**Council advice (validated against real code):**
- **Elon (infrastructure)**: Correct — PostGIS, 86 edge functions, real-time tracking, Stripe webhook, NFC, FCM push — all real. Caught exaggerating re: "AI concierge" (handle_voice exists but uses generic web search, not LLM fine-tuned on G-Taxi data).
- **Zuck (execution)**: Correct — 72K lines, 7 apps, all verticals have code — the sprawl is real. Caught misleading re: "Pokémon Go gamification for drivers" — no such feature exists in app or migrations.
- **Bezos (customer obsession)**: Correct — cold start is bad, restaurant/barber/salon are unfinished. Caught wrong re: "partner feedback loop" — no Partner API exists.

**Resulting strategy (user-approved):**
- Global is NOT an option — focus on Trinidad and Tobago dominance
- G-Wallet IS needed — cash is dominant in T&T, driver settlement requires wallet
- NFC is good for this market (phone-to-NFC-kiosk at malls) but don't overbuild
- Fix cold start latency first, then food delivery constraint, then service booking — in that order

### 2026-06-27 — G-Escape group demand aggregator: backend built, Amadeus/Booking APIs wired

**What we did this session:**

1. **Identified the `credit_wallet` RPC gap** — confirmed missing from DB. The `cancel_travel_booking` edge function had a fallback path, but the RPC was never created. Now it exists.

2. **Built the G-Escape group demand aggregator backend** — 3 new migrations, 4 new edge functions, 1 new admin RPC.

3. **Migrations applied to production DB:**
   - `20260627000000_credit_wallet_rpc` — `credit_wallet(p_user_id, p_amount_cents, p_type, p_description, p_reference_id)` with idempotency check + wallets table cached balance update
   - `20260627000001_escape_group_booking` — 5 new tables: `flight_cache` (Amadeus), `lodging_cache` (Booking.com), `escape_group_participants` (intent→paid status machine), `passenger_details` (passport/ID post-confirmation), `group_booking_alerts` (delay/reschedule/refund log)
   - `20260627000002_escape_group_admin_tools` — `min_guests_threshold`, `charge_deadline`, `charter_reference`, `confirmed_guests` columns + `increment_allocated_guests`/`increment_confirmed_guests` RPCs
   - `20260627000003_admin_escape_actions_rpc` — `admin_escape_action(package_id, action, ...)` — confirm/delay/refund_all in one SECURITY DEFINER RPC

4. **Edge functions deployed:**
   - `sync_flight_availability` — Scans 8 routes × 14 dates via Amadeus Flight Offers Search API (±8ms delay between calls). Returns: flight number, available seats, fare cents. Handle: returns 503 if `AMADEUS_API_KEY`/`AMADEUS_API_SECRET` not set.
   - `sync_lodging_availability` — Scans 4 locations × 4 date ranges via Booking.com XML API. Returns: property name, available rooms, nightly rate. Handle: returns 503 if `BOOKING_API_KEY` not set.
   - `join_escape_group` — Rider joins a package → `intent_pending` status. Guards: capacity check, duplicate check, 1-20 party_size. Requires JWT auth.
   - `auto_charge_escape_group` — Cron: finds packages where `allocated_guests >= min_guests_threshold`, charges via `process_wallet_payment_hardened` (wallet) or Stripe PaymentIntent fallback. Creates `payment_pending`/`confirmed` transitions.

5. **Amadeus Django demo repo analyzed** (`amadeus4dev/amadeus-flight-booking-django`): Shows official 3-step booking flow:
   - **Step 1**: Flight Offers Search (what our sync does)
   - **Step 2**: Flight Offers Price (confirm current price/availability)
   - **Step 3**: Flight Create Orders (book with traveler details)
   - Also: Trip Purpose Prediction API, Airport Search autocomplete, airline logos via `s1.apideeplink.com`
   - We must use these steps when admin calls `admin_escape_action('confirm')` for actual charter booking

6. **CAL/API advice provided:**
   - Amadeus: `https://developers.amadeus.com/register` — free tier, 2K calls/mo, covers CAL
   - Booking.com: `https://partner.booking.com/` — affiliate partner program
   - CAL direct: `+1 (868) 625-7200`, ask for Commercial Partnerships

**Key decision:** `admin_confirm_escape_seats` was built as edge function but hit the function cap (60+ already). Merged into `admin_escape_action` RPC instead — admin calls `supabase.rpc('admin_escape_action', { p_package_id, p_action: 'confirm', p_booking_ref: '...' })`.

**Gaps still open for "true business tool" confirmation:**
- Edge function secrets (AMADEUS_API_KEY, AMADEUS_API_SECRET, BOOKING_API_KEY, STRIPE_SECRET_KEY, etc.) — require dashboard config
- `sync_flight_availability`/`sync_lodging_availability` need cron schedule set in Supabase dashboard
- G-Escape rider + admin screens not yet coded (need UI for browsing packages, joining, passport submission, admin demand dashboard)
- Grocery/laundry checkout still doesn't charge rider
- Dispatch queue still a no-op
- `credit_wallet` RPC now exists but was the only truly missing DB object

### 2026-06-20 — Pod Commander + Territory system: backend built, 5 functions deployed

**What we did this session:**

1. **Created `user_role` ENUM** — Migrated `profiles.role` from TEXT CHECK to real ENUM (`rider`, `driver`, `admin`, `pod_commander`, `merchant`). Dropped old CHECK constraint. Migrated `'user'` → `'rider'`. Recreated all 33 RLS policies that referenced the role column.

2. **Built Territory system** — New `territories` table with name/code/region_id/boundary_geojson/commander_id/geography tracking. RLS: admins full, commanders read own, public read active.

3. **Built Pod Commander system** — New `pod_commanders` table with auto-generated `onboarding_code` trigger + auto-create trigger when `profiles.role` changes to `pod_commander`. RLS: service_role only.

4. **Extended puck lifecycle** — Added to `kiosk_nodes`: `lifecycle_status` (manufactured→assigned→activated→live→suspended→replaced), `hardware_version`, `firmware_version`, `battery_level`, `last_heartbeat`, `replaced_by`, `assigned_to`, `commissioned_at`, `decommissioned_at`, `territory_id`.

5. **Created `puck_events` analytics table** — Event types: tap/scan/ride_requested/ride_completed/first_ride/revenue/heartbeat/status_change/battery_alert. Proper indexes.

6. **Updated `_shared/auth.ts`** — Added `requireCommander()` helper (checks `profiles.role = 'pod_commander'` + `pod_commanders.status = 'active'`).

7. **Deployed 5 edge functions:**
   - `admin_manage_territories` — CRUD for territories
   - `admin_manage_commanders` — CRUD for commanders, territory assignment
   - `admin_manage_puck_inventory` — Register/assign/update lifecycle for pucks
   - `commander_get_territory` — Territory overview + metrics
   - `commander_get_pucks` — List pucks in territory

8. **Created source for 7 more edge functions** (blocked by Supabase 60-function limit, project has ~96):
   - `commander_update_puck_status`, `commander_onboard_driver`, `commander_onboard_merchant`, `commander_get_driver_queue`, `puck_heartbeat`, `register_driver_with_code`, `merchant_register_with_code`

**Updated next steps in this session:**
- Deleted 8 unused functions: approve_driver, merchant_signup, track_flight_status, sync_flight_availability, sync_lodging_availability, whatsapp_webhook, confirm_escape_payment, admin_manage_nodes ✅
- Deployed remaining 7 edge functions: commander_update_puck_status, commander_onboard_driver, commander_onboard_merchant, commander_get_driver_queue, puck_heartbeat, register_driver_with_code, merchant_register_with_code ✅

**Next steps:**
- Build Territories/Commanders/PuckManager admin pages
- Build CommanderDashboardScreen in driver app

### 2026-07-01 — Stabilization Ladder (Rungs 0–4) + admin design errors fixed

**What we did:**

1. **Rung 0 — Migration reconciliation**: Fixed a year of migration drift. ~87 remote-only tracking entries (from MCP direct-SQL operations) were repaired as `reverted`. ~38 local-only tracking entries repaired as `applied`. Renamed 3 short-name migration files (`20260617_nfc_pipeline_fix`, `20260618_wipay_payouts`, `20260618_cron_schedules_deploy`) to proper 14-digit timestamps. Resolved `20260622000000` filename collision. Final state: 0 local-only, 0 remote-only. Fresh backup exists.

2. **Rung 1 — Redis ON**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REDIS_URL` confirmed SET in Supabase edge function secrets. Lazy-init `redis.ts` auto-detects config at runtime.

3. **Rung 2 — Killed dual polling**: `realtime.ts` `useRideSubscription` and `useDriverLocationSubscription` both had unconditional polling running alongside Realtime subscriptions. Rewired to poll ONLY when WebSocket disconnects (TIMED_OUT / CHANNEL_ERROR), with 30s reconnect attempt. `useNearbyDrivers` poll reduced from 3s → 10s.

4. **Rung 3 — FK indexes + dead index cleanup**: Created migration `20260701_fk_indexes_cleanup` adding critical missing FK indexes on `dispatch_queue`, `drivers(active_ride_id)`, `rides(merchant_id)`, `rides(admin_id)`, `ride_offers`, `orders` (3 cols), `order_items` (2 cols), `emergency_logs`, `incident_reports`, `payout_requests`, `admin_audit_log`, `platform_revenue_logs`, `user_events`, `split_sessions`, `nfc_sessions`, `support_tickets`. Dropped 17 unused indexes (all `idx_scan = 0`, small but write-overhead).

5. **Rung 4 — Plan check**: Org on **Free plan**. Pro ($25/mo) needed before launch for PITR, 8GB DB, 50GB bandwidth, 7-day log retention.

6. **Admin CSS token fixes**: `index.css` neon classes referenced `var(--neon-cyan)`/`var(--neon-purple)`/`var(--dark-hud)`/`var(--elegant-purple)` that were never defined in `:root` — rendering those elements invisible. Fixed to use `var(--cyan)`, `var(--accent)`, `var(--surface-base)`. Removed duplicate `img` and scrollbar blocks. `Login.tsx` updated to use `var(--accent)` instead of undefined `var(--elegant-purple)`.

**Key decisions:**
- No `supabase db pull` — Docker timeout on shadow DB. Tracking table is clean; existing backup `remote_schema_20260623.sql` (24K lines) is sufficient.
- Subscription fallback polling at 5s intervals (not 3s), with auto-reconnect at 30s. Save ~1 DB query/3s per active rider when WS is healthy.
- 17 unused indexes dropped — at 16kB each they're negligible size but every INSERT/UPDATE paid the write cost.

**Still pending:**
- Upgrade Supabase org to Pro plan (~$25/mo)
- Rung 5+ (realtime channel count monitoring, query planner tuning, connection pooling) — deferred until after feature launch

### 2026-06-14 — Cleanup purge + pricing strategy clarified

**Cleanup**: Purged ~100 stale files (audits, agent screenshots, build logs, old docs).
Kept agent-guiding files (AGENTS.md, CLAUDE.md, PRODUCT.md, COMPLIANCE_CHECKLIST.md,
docs/HANDOFF.md, docs/agents/). See commit 1a4bc388.

**Pricing model** (clarified):
- Rides feed the driver network; the driver network feeds all verticals
- Pricing = base ($16) + time ($0.95/min) + distance ($1.75/km), $22 min fare
- Zone rates override formula (guaranteed minimums per route, e.g. POS→Piarco = $80)
- driver_zone_pricing table already exists, driver_zone_rates per driver variant
- 81% driver split across ALL verticals (rides, delivery, merchant, travel)
- Platform margin varies by vertical: rides 12% → others up to 20%
- Admin toggles verticals via vertical_settings table (enabled, name, icon, etc.)
- All settlement happens through rides table (not separate settlement events)

---

## SESSION RULES

- Read the actual file before changing it — never assume its contents
- Only touch files within the scope of the current task
- Output complete files only — no partial snippets
- After each file change, state what verification command confirms it worked
- If you encounter an error you cannot resolve, stop and report it clearly
  Do not attempt to work around errors silently
