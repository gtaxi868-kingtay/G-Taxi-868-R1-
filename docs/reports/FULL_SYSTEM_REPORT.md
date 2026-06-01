# G-TAXI — FULL SYSTEM REPORT

**Generated:** 2026-05-27  
**Project:** g-taxi-rider  
**Branch:** monorepo-recovery  
**Node:** v20.19.6 | **npm:** 10.8.2  

---

## 1. EXECUTIVE SUMMARY

| Category | Status | Confidence |
|----------|--------|-----------|
| **Production Ready** | ❌ **NO** | 8% |
| **Security** | ⚠️ Partially Hardened | 40% |
| **Payment** | ❌ Not Integrated | 5% |
| **Backend (DB + Edge Functions)** | ✅ Functional | 60% |
| **Mobile Apps (Rider/Driver)** | ⚠️ Compiles, Untested | 40% |
| **Admin Dashboard** | ✅ Boots, Auth Gate Active | 65% |
| **Push Notifications** | ❌ Not Wired | 0% |
| **Testing** | ❌ None | 0% |

### Completed Repairs (Phases 1–4)
- ✅ Phase 1 — Admin security lockdown (SERVICE_ROLE_KEY removed, server-side admin check via edge function)
- ✅ Phase 2 — Edge function auth (accept_ride & update_driver_location use JWT-based identity)
- ✅ Phase 3 — Database crash fixes (complete_ride state machine + cash payment_ledger)
- ✅ Phase 4 — Driver app build fix (duplicate imports/state removed)
- ✅ All 86 migrations pushed & synced to Supabase cloud
- ✅ All 3 apps pass `npx tsc --noEmit`

### Remaining Phases (5–13)
- ❌ Phase 5 — Push notifications (Firebase FCM) — NOT STARTED
- ❌ Phase 6 — Stripe payment integration — NOT STARTED
- ⚠️ Phase 7 — RLS and data privacy — PARTIAL
- ⚠️ Phase 8 — Ride state machine lock — PARTIAL
- ❌ Phase 9 — GPS spoof detection — NOT STARTED
- ❌ Phase 10 — Rate limiting — NOT STARTED
- ❌ Phase 11 — GPS data retention + pg_cron — NOT STARTED
- ❌ Phase 12 — Monitoring + Sentry — NOT STARTED
- ❌ Phase 13 — App store submission prep — NOT STARTED

---

## 2. PROJECT ARCHITECTURE

### 2.1 Applications (7)

| App | Framework | Type | TypeScript | Status |
|-----|-----------|------|-----------|--------|
| `apps/rider/` | Expo 52 + RN 0.76.9 | Mobile (Android/iOS) | ✅ | Compiles |
| `apps/driver/` | Expo 52 + RN 0.76.9 | Mobile (Android/iOS) | ✅ | Compiles |
| `apps/admin/` | Vite 7 + React 18 | Web (Dashboard) | ✅ | Compiles, Auth Gate Active |
| `apps/merchant/` | Vite 6 + React 18 | Web (Portal) | ✅ | Minimal |
| `apps/admin-mobile/` | Expo 52 | Mobile | ✅ | Minimal |
| `apps/merchant-mobile/` | Expo 52 | Mobile | ✅ | Minimal |
| `apps/qr-landing/` | Static HTML | Web | ❌ | Placeholder |

### 2.2 Internal Packages (8)

| Package | Consumers | Has Native Deps |
|---------|-----------|----------------|
| `packages/api/` | admin | ❌ |
| `packages/bootstrap/` | rider, driver | ❌ |
| `packages/config/` | All | ❌ |
| `packages/core/` | — | ❌ |
| `packages/design-system/` | rider, driver, admin | ✅ ⚠️ |
| `packages/design-system-native/` | — | ✅ |
| `packages/design-system-web/` | — | ❌ |
| `packages/shared/` | rider, driver, admin | ✅ ⚠️ |
| `packages/shared-web/` | admin | ❌ |

> ⚠️ **Known issue:** `admin` imports `@gtaxi/design-system` and `@gtaxi/shared`, which transitively pull in Expo/React Native deps into the web-only admin build. This violates the monorepo isolation constraint. Fix: migrate admin to web-only variants.

### 2.3 Database (Supabase Postgres + PostGIS)

**Connection:** Port 6543 (transaction mode pooler — enforced in all edge functions)

**Extensions Installed (active):**
- `postgis` (3.3.7) — spatial/GIS
- `vector` (0.8.0) — pgvector embeddings
- `pg_cron` (1.6.4) — scheduled jobs
- `pgcrypto` (1.3) — cryptographic functions
- `uuid-ossp` (1.1) — UUID generation
- `pg_stat_statements` (1.11) — query monitoring
- `supabase_vault` (0.3.1) — encrypted secrets

### 2.4 Database Tables (68 total)

**Core tables by data volume:**

| Table | Row Count | Columns | Size |
|-------|-----------|---------|------|
| `profiles` | 4 | 24 | 104 kB |
| `rides` | 1 | 61 | 136 kB |
| `drivers` | 1 | 32 | 120 kB |
| `ride_events` | 6 | 7 | 32 kB |
| `ride_offers` | 1 | 8 | 48 kB |
| `payment_ledger` | 0 | 10 | 48 kB |
| `wallet_transactions` | 0 | 10 | 40 kB |
| `driver_locations` | 0 | 8 | 24 kB |
| `fleet_leases` | 0 | 18 | 40 kB |
| `fleet_vehicles` | 0 | 21 | 32 kB |
| `rate_limit_log` | 0 | 5 | 64 kB |
| `revenue_splits` | 0 | 10 | 40 kB |
| `capital_reserve_ledger` | 0 | 8 | 40 kB |
| `waitlist` | 0 | 7 | 24 kB |

**Notable table groups:**
- **Ride system:** `rides`, `ride_events`, `ride_offers`, `ride_messages`, `ride_stops`, `stop_suggestions`
- **Driver:** `drivers`, `driver_documents`, `driver_locations`, `driver_ai_strategy`
- **Payment:** `payment_ledger`, `wallet_transactions`, `capital_reserve_ledger`, `revenue_splits`, `platform_revenue_logs`, `payout_requests`, `manual_deposits`
- **Fleet:** `fleet_vehicles`, `fleet_leases`, `lease_payments`, `dealer_partners`, `vehicle_inventory`, `vehicle_sales`
- **Merchant:** `merchants`, `merchant_services`, `merchant_api_keys`, `merchant_appointments`, `merchant_intake_logs`
- **Orders:** `orders`, `order_items`, `order_substitutions`, `order_handoff_pins`
- **Other:** `profiles`, `ratings`, `saved_places`, `locations`, `pricing_zones`, `region_settings`, `system_config`, `system_feature_flags`, `taxi_stands`, `blacklists`, `sos_events`, `identity_tags`, `nfc_event_logs`, `user_memories`, `user_preferred_drivers`, `user_events`, `subscription_benefits`, `gps_spoof_log`, `incident_reports`, `kiosk_nodes`, `demand_patterns`, `vertical_settings`, `rider_capabilities`, `rider_stop_preferences`, `rider_ai_preferences`, `stripe_config`, `admin_promos`, `user_promos`, `user_service_history`, `airline_flights`, `flight_bookings`, `hotel_bookings`, `products`, `spatial_ref_sys` (PostGIS internal)

### 2.5 Migrations (86 applied)

All 86 local migrations are synced with remote Supabase. Key recent migrations:

| File | Purpose |
|------|---------|
| `20260528001314_create_gtaxi_waitlist.sql` | Waitlist table (Dashboard-created) |
| `20260526000001_phase4_rls_fixes.sql` | RLS policy fixes for Phase 4 |
| `20260524000001_optimized_marketplace.sql` | Marketplace optimizations |
| `20260522000001_capital_reserve_ledger.sql` | Capital reserve financial table |
| `20260522000000_fleet_asset_architecture.sql` | Fleet asset management |
| `20260519140000_fix_drivers_map_view_rls.sql` | Driver map view RLS fix |
| `20260519094932_phase3_crash_fixes.sql` | Phase 3 crash fixes |
| `20260408020000_add_safe_entry_to_rides.sql` | Safe entry on rides |
| `20260408010000_manual_deposits_schema.sql` | Manual deposits |
| `20260408000000_financial_monster_ledger.sql` | Financial ledger expansion |

### 2.6 Edge Functions (69 deployed)

**Function count by category:**

| Category | Count | Examples |
|----------|-------|---------|
| Core ride flow | 8 | `create_ride`, `accept_ride`, `complete_ride`, `cancel_ride`, `match_driver`, `get_active_ride`, `decline_ride`, `expire_offer` |
| Admin | 16 | `admin_get_users`, `admin_get_flags`, `admin_toggle_driver`, `admin_toggle_role`, `admin_assign_driver`, `admin_force_complete`, `admin_refund`, `admin_cancel_ride`, `admin_settle_debt`, `admin_suspend_rider`, `admin_get_rides`, `admin_get_pending_drivers`, `admin_get_revenue_logs`, `admin_get_pending_deposits`, `admin_verify_deposit`, `admin_toggle_flag`, `admin_manage_nodes`, `admin_create_merchant_user` |
| Merchant | 6 | `merchant_dispatch`, `merchant_gateway`, `merchant_order_picker`, `merchant_update_order_status`, `process_merchant_consent`, `match_order_delivery` |
| AI/Voice | 5 | `ai_concierge_proactive`, `generate_ai_greeting`, `handle_voice`, `parse_natural_language`, `identify_product` |
| Payment | 4 | `create_payment_intent`, `stripe_webhook`, `create_wallet_topup`, `create_stripe_customer` |
| Push/Notification | 4 | `send_push_notification`, `daily_push_notifications`, `check_push_status`, `trigger_emergency` |
| NFC | 2 | `nfc_event_handler`, `nfc_restore_session` |
| Other | 21 | `geocode`, `estimate_fare`, `update_driver_location`, `update_ride_status`, `auto-match-bot`, `mirror_ride`, `suggest_stops`, `get_nearby_drivers`, `get_user_patterns`, `update_user_memory`, `delete_account`, `get_system_status`, `vision_pickup`, `verify_handoff`, `concierge_dispatch`, `whatsapp_webhook`, `region_settings`, `dealer_brokerage`, `fleet_lease_engine`, `update_order_price`, `approve_driver` |

**Shared utilities** (`supabase/functions/_shared/`): 9 modules — `auth.ts`, `fcm.ts`, `merchant_auth.ts`, `pricing.ts`, `push.ts`, `rateLimit.ts`, `redis.ts`, `sentry.ts`, `sms.ts`

**verify_jwt settings (⚠️ PRIORITY — many are disabled):**

| Slug | verify_jwt | Status |
|------|-----------|--------|
| `create_ride` | ✅ true | Secure |
| `geocode` | ✅ true | Secure |
| `update_ride_status` | ✅ true | Secure |
| `create_payment_intent` | ✅ true | Secure |
| `decline_ride` | ✅ true | Secure |
| `admin_assign_driver` | ✅ true | Secure |
| `admin_force_complete` | ✅ true | Secure |
| `admin_suspend_rider` | ✅ true | Secure |
| `admin_refund` | ✅ true | Secure |
| `ai_concierge_proactive` | ✅ true | Secure |
| `handle_voice` | ✅ true | Secure |
| `send_push_notification` | ✅ true | Secure |
| `whatsapp_webhook` | ✅ true | Secure |
| `approve_driver` | ✅ true | Secure |
| `complete_ride` | ❌ **false** | ⚠️ Unverified |
| `accept_ride` | ❌ **false** | ⚠️ Unverified |
| `match_driver` | ❌ **false** | ⚠️ Unverified |
| `cancel_ride` | ❌ **false** | ⚠️ Unverified |
| `estimate_fare` | ❌ **false** | ⚠️ Unverified |
| `update_driver_location` | ❌ **false** | ⚠️ Unverified |
| `get_active_ride` | ❌ **false** | ⚠️ Unverified |
| `stripe_webhook` | ❌ **false** | ✅ Intentional (needs raw body) |
| `admin_get_flags` | ❌ **false** | ⚠️ Custom auth (uses `requireAdmin`) |
| `admin_get_users` | ❌ **false** | ⚠️ Custom auth |
| `admin_toggle_driver` | ❌ **false** | ⚠️ Custom auth |
| `admin_toggle_role` | ❌ **false** | ⚠️ Custom auth |
| `admin_settle_debt` | ❌ **false** | ⚠️ Custom auth |
| `admin_cancel_ride` | ❌ **false** | ⚠️ Custom auth |
| `admin_toggle_flag` | ❌ **false** | ⚠️ Custom auth |
| `admin_get_rides` | ❌ **false** | ⚠️ Custom auth |
| `admin_get_pending_drivers` | ❌ **false** | ⚠️ Custom auth |
| `parse_natural_language` | ❌ **false** | ⚠️ Custom auth |
| `whatsapp_webhook` | ❌ **false** | ⚠️ Custom auth |
| `admin_manage_nodes` | ❌ **false** | ⚠️ Custom auth |
| `admin_create_merchant_user` | ❌ **false** | ⚠️ Custom auth |

> Functions with `verify_jwt=false` rely on custom auth logic inside the function body (e.g., `requireAdmin`, `requireDriver`). These must be individually audited to confirm they verify the JWT before processing.

---

## 3. SECURITY POSTURE

### 3.1 Fixed (Phases 1–4)
| Issue | Status | Detail |
|-------|--------|--------|
| SERVICE_ROLE_KEY in admin .env | ✅ **FIXED** | Removed, only in Supabase edge function env vars |
| Admin dashboard public | ✅ **FIXED** | `AdminSecurityGate` now uses server-side `admin_get_flags` edge function |
| `accept_ride` trusts client `driver_id` | ✅ **FIXED** | Uses `requireDriver()` — resolves from JWT |
| `update_driver_location` no auth | ✅ **FIXED** | Uses `requireDriver()` — JWT verified before write |
| `profiles` world-readable | ❌ **NOT FIXED** | Phase 7 |
| `complete_ride` allows `assigned`→`completed` | ✅ **FIXED** | Only `in_progress`→`completed` now |
| Cash ride doesn't write `payment_ledger` | ✅ **FIXED** | Cash path now writes to `payment_ledger` |
| Duplicate `Sidebar`/`useState` in DashboardScreen | ✅ **FIXED** | Cleans imports |

### 3.2 Remaining Security Issues

| Issue | Severity | Phase | Detail |
|-------|----------|-------|--------|
| `profiles` table world-readable | 🔴 CRITICAL | Phase 7 | Any rider can query any user's PII |
| 3 tables with RLS enabled but no policies | 🟠 HIGH | Phase 7 | `merchant_intake_logs`, `stripe_config`, `user_service_history` |
| Security definer views | 🟠 HIGH | Phase 7 | Views bypass RLS |
| CORS `*` on all edge functions | 🟠 HIGH | Phase 12 | Should restrict to app origins |
| Unindexed foreign keys (20+ tables) | 🟡 MEDIUM | Phase 11 | Performance + query slowdown |
| `verify_jwt=false` on non-webhook functions | 🟠 HIGH | Phase 2 | Relies on custom auth — needs individual audit |
| Stripe secret key usage in webhook | 🟠 HIGH | Phase 6 | Must never leak to client |
| No request body validation | 🟡 MEDIUM | Phase 8 | Edge functions assume well-formed payloads |
| Rate limiting missing from most functions | 🟡 MEDIUM | Phase 10 | Only `create_ride` has it |

### 3.3 Advisor Lints

**Security advisories:**
- `rls_enabled_no_policy`: 3 tables (merchant_intake_logs, stripe_config, user_service_history)
- `security_definer_view`: Multiple views (needs audit)

**Performance advisories:**
- `unindexed_foreign_keys`: Many tables missing FK indexes (over 20 detections)

---

## 4. FINANCIAL ARCHITECTURE — CATASTROPHIC FAILURES

From SIEGE_REPORT.md (2026-05-22):

### Failure #1 — `driverPayoutCents` is always `undefined`
- **File:** `supabase/functions/complete_ride/index.ts:220`
- **Bug:** `computeSettlement()` returns `{ driverPayout }` but destructuring asks for `driverPayoutCents` → always `undefined`
- **Impact:** NULL driver payout written to DB on every cash/card ride completion
- **Fix:** Rename destructure to `{ driverPayout: driverPayoutCents }`

### Failure #2 — Stripe webhook always returns HTTP 200
- **File:** `supabase/functions/stripe_webhook/index.ts`
- **Bug:** All 5 disbursement steps use `.catch()` that logs errors but continues; function always returns 200
- **Impact:** Stripe never retries failed webhooks — driver never paid, platform revenue lost
- **Fix:** Return 500 on any step failure so Stripe retries

### Failure #3 — No legal entity isolation
- **Bug:** Single `PLATFORM_ACCOUNT = "00000000-0000-0000-0000-000000000000"` UUID commingles ride ops, fleet leasing, and capital reserve
- **Impact:** A lawsuit freezing that wallet freezes everything
- **Fix:** Create separate wallet accounts per legal entity

### Failure #4 — No collusion detection
- **Bug:** `rides.platform_leakage_detected` column exists but no code ever sets it to true
- **Impact:** 19% fee leakage invisible — driver/rider pairs can go off-app
- **Fix:** Implement daily batch for driver/rider pair frequency analysis

### Failure #5 — Zero driver retention
- **Bug:** No loyalty system, no bonus credits, no vesting mechanisms
- **Impact:** Drivers leave for 1% higher payout elsewhere
- **Fix:** Implement "Stickiness Pool" with escrowed bonuses

---

## 5. ENVIRONMENT & CONFIGURATION

### 5.1 Public Keys (Safe in .env files)
```
apps/rider/.env:
  EXPO_PUBLIC_SUPABASE_URL           ← Public
  EXPO_PUBLIC_SUPABASE_ANON_KEY      ← Public (anon key)
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN    ← Public
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ← Public
  EXPO_PUBLIC_SENTRY_DSN             ← Public

apps/driver/.env:
  EXPO_PUBLIC_SUPABASE_URL           ← Public
  EXPO_PUBLIC_SUPABASE_ANON_KEY      ← Public
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN    ← Public
  EXPO_PUBLIC_SENTRY_DSN             ← Public

apps/admin/.env:
  VITE_SUPABASE_URL                  ← Public
  VITE_SUPABASE_ANON_KEY             ← Public
  # No SERVICE_ROLE_KEY — confirmed removed
```

### 5.2 Supabase Edge Function Secrets (Dashboard only — never in files)
```
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
FIREBASE_SERVICE_ACCOUNT_JSON (base64)
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PROXY_SERVICE_SID
SENTRY_DSN
```

### 5.3 LinkedIn External Services
| Service | Status | Purpose |
|---------|--------|---------|
| Supabase | ✅ Connected | Auth, DB, Edge Functions, Realtime |
| Mapbox | ✅ Key present | Maps, geocoding |
| Stripe | ⚠️ Keys set but integration incomplete | Payments |
| Firebase FCM | ⚠️ Not integrated | Push notifications |
| Twilio | ⚠️ Not integrated | SMS / phone |
| Sentry | ⚠️ DSN set, mock in app | Error tracking |

---

## 6. TYPE CHECK & BUILD STATUS

| App | `npx tsc --noEmit` | `npm run lint` | Notes |
|-----|-------------------|----------------|-------|
| `apps/admin/` | ✅ PASS | ✅ PASS | — |
| `apps/rider/` | ✅ PASS | ✅ PASS | — |
| `apps/driver/` | ✅ PASS | ✅ PASS | — |
| `apps/merchant/` | ✅ PASS | ✅ PASS | Minimal codebase |
| `apps/admin-mobile/` | ✅ PASS | ✅ PASS | Minimal |
| `apps/merchant-mobile/` | ✅ PASS | ✅ PASS | Minimal |
| `packages/*/` | ✅ PASS | — | Internal packages |

---

## 7. RIDE STATE MACHINE

```
searching → assigned → arrived → in_progress → completed → payment_confirmed → closed
```

### Current enforcement
| Transition | Enforcement | Status |
|-----------|-------------|--------|
| `searching`→`assigned` | `match_driver` edge function | OK |
| `assigned`→`arrived` | Client calls `update_ride_status` | OK |
| `arrived`→`in_progress` | Client calls `update_ride_status` | OK |
| `in_progress`→`completed` | `complete_ride` edge function, `.in(['in_progress'])` | ✅ FIXED |
| `completed`→`payment_confirmed` | Stripe webhook / `process_wallet_payment_hardened` | ⚠️ Not enforced in schema |
| `payment_confirmed`→`closed` | Admin only | ⚠️ Not enforced in schema |

### Missing states
- `payment_confirmed` — exists in concept but not enforced in DB CHECK constraint
- `closed` — no DB CHECK constraint
- Payment flow: `pending→authorized→captured→confirmed→receipt_sent` — schema has `payment_status` column but no CHECK constraint

---

## 8. RLS POLICY STATUS

| Table | RLS | Policy Coverage | Status |
|-------|-----|----------------|--------|
| `profiles` | ✅ On | Should restrict to own/current driver or rider | ⚠️ **World-readable** (Phase 7) |
| `rides` | ✅ On | Own rides | OK |
| `ride_events` | ✅ On | Append-only, own rides | OK |
| `ride_offers` | ✅ On | Driver-specific | OK |
| `ride_stops` | ✅ On | Via ride FK | OK |
| `payment_ledger` | ✅ On | Read own, INSERT via service role | OK |
| `drivers` | ✅ On | Driver-specific | OK |
| `driver_locations` | ✅ On | Current driver | OK |
| `wallet_transactions` | ✅ On | Own wallet | OK |
| `merchant_intake_logs` | ✅ On | **NO POLICIES** | ❌ |
| `stripe_config` | ✅ On | **NO POLICIES** | ❌ |
| `user_service_history` | ✅ On | **NO POLICIES** | ❌ |
| *(all other tables)* | ✅ On | Varies | ⚠️ Needs audit |

---

## 9. KNOWN BUGS TRACKER

| ID | Bug | File | Severity | Status |
|----|-----|------|----------|--------|
| B-001 | `driverPayoutCents` is undefined (naming mismatch) | `complete_ride/index.ts:220` | 🔴 CRITICAL | NOT FIXED |
| B-002 | Stripe webhook returns 200 on partial failure | `stripe_webhook/index.ts` | 🔴 CRITICAL | NOT FIXED |
| B-003 | Single PLATFORM_ACCOUNT for all entities | All financial functions | 🟠 HIGH | NOT FIXED |
| B-004 | No collusion detection (dead column) | `rides.platform_leakage_detected` | 🟠 HIGH | NOT FIXED |
| B-005 | No driver retention/loyalty system | — | 🟡 MEDIUM | NOT FIXED |
| B-006 | Admin imports packages with native deps | `apps/admin/package.json` | 🟡 MEDIUM | NOT FIXED |
| B-007 | Stripe SDK not installed | `apps/rider/package.json` | 🔴 CRITICAL | NOT FIXED |
| B-008 | Payment screen has empty Stripe import | `apps/rider/src/screens/PaymentScreen.tsx` | 🔴 CRITICAL | NOT FIXED |
| B-009 | `@supabase/supabase-js` not listed in shared deps | `packages/shared/package.json` | 🔴 CRITICAL | NOT FIXED |

---

## 10. NEXT STEPS & PRIORITY ORDER

### P0 — Immediate (before any further development)
1. Fix `driverPayoutCents` naming bug (1 line, SIEGE #1)
2. Fix Stripe webhook to return 500 on failure (15 lines, SIEGE #2)
3. Install `@supabase/supabase-js` in `packages/shared/`

### P1 — Phase 5: Push Notifications
4. Wire Firebase FCM + `expo-notifications`
5. Deploy push notification edge functions

### P2 — Phase 6: Stripe Integration
6. Install `@stripe/stripe-react-native`
7. Fix PaymentScreen.tsx empty import
8. End-to-end test card payment flow

### P3 — Phase 7: RLS & Data Privacy
9. Fix `profiles` table world-readable policy
10. Add policies for 3 uncovered tables
11. Audit all RLS policies

### P4 — Phase 8: Ride State Machine Lock
12. Add DB CHECK constraints for valid state transitions
13. Add `payment_status` CHECK constraints
14. Enforce `payment_confirmed` and `closed` states

### P5 — Phases 9–13: Hardening
15. GPS spoof detection (Phase 9)
16. Rate limiting on all edge functions (Phase 10)
17. GPS data retention + pg_cron cleanup (Phase 11)
18. Sentry monitoring + CORS restriction (Phase 12)
19. App store submission prep (Phase 13)

---

## 11. FILE INDEX — CRITICAL TOUCHPOINTS

| File | Role | Notes |
|------|------|-------|
| `supabase/functions/complete_ride/index.ts` | Ride completion logic | **B-001** (driverPayoutCents) |
| `supabase/functions/stripe_webhook/index.ts` | Payment webhook | **B-002** (200 on failure) |
| `supabase/functions/accept_ride/index.ts` | Ride acceptance | ✅ Fixed (Phase 2) |
| `supabase/functions/update_driver_location/index.ts` | Driver GPS | ✅ Fixed (Phase 2) |
| `apps/admin/src/App.tsx` | Admin dashboard entry | ✅ Fixed (Phase 1) |
| `apps/driver/src/screens/DashboardScreen.tsx` | Driver home screen | ✅ Fixed (Phase 4) |
| `apps/rider/src/screens/PaymentScreen.tsx` | Payment UI | ❌ Empty Stripe import (B-008) |
| `apps/rider/src/context/AuthContext.tsx` | Auth state | ❌ Depends on missing supabase-js |
| `apps/rider/src/context/RideContext.tsx` | Ride state | ❌ Depends on missing supabase-js |
| `packages/shared/src/supabase.ts` | Supabase client | ❌ Missing dep in package.json |
| `packages/shared/package.json` | Shared deps | ❌ Missing @supabase/supabase-js |
| `supabase/functions/_shared/auth.ts` | Auth utilities | Shared by all edge functions |
| `CLAUDE.md` | Project context | Source of truth for conventions |

---

## 12. APPENDIX: SECURITY ADVISOR DETAILS

### RLS Enabled Without Policy (3 tables)
1. `public.merchant_intake_logs` — no SELECT/INSERT/UPDATE/DELETE policies
2. `public.stripe_config` — no SELECT/INSERT/UPDATE/DELETE policies
3. `public.user_service_history` — no SELECT/INSERT/UPDATE/DELETE policies

### Security Definer Views (partial list)
- Multiple views use `SECURITY DEFINER` — runs with owner's privileges, bypassing RLS. Needs full audit.

### Unindexed Foreign Keys (partial list)
Tables missing FK indexes include: `airline_flights`, `capital_reserve_ledger`, `driver_documents`, `driver_locations`, `gps_spoof_log`, `merchant_intake_logs`, `order_handoff_pins`, `ride_stops`, and many more.

---

**Report Generated:** 2026-05-27  
**Source:** Live Supabase queries + codebase analysis  
**Confidence:** Data is current as of time of generation
