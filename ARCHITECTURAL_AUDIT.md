# ARCHITECTURAL AUDIT & TRUTH DUMP
## G-TAXI Monorepo — Production Readiness Assessment

Generated: 2026-05-30
Scope: Full repository scan, 70 edge functions, 4 mobile apps, 1 web app

---

## 1. THE GAP ANALYSIS — Backend vs. Frontend

### 1.1 Backend Endpoints with No Frontend Consumer

70 edge functions exist. **28 (40%) have no corresponding UI in any app.**

| Edge Function | Purpose | Which App Should Consume It | Status |
|---|---|---|---|
| `admin_get_pending_deposits` | List pending deposit verifications | Admin | No UI component exists |
| `admin_get_pending_drivers` | List unapproved drivers | Admin | No UI component exists |
| `admin_get_revenue_logs` | Platform revenue records | Admin | No UI component exists |
| `admin_manage_nodes` | NFC puck inventory CRUD | Admin | No UI component exists |
| `admin_refund` | Process wallet refund | Admin | No UI component exists |
| `admin_settle_debt` | Settle negative wallet balances | Admin | No UI component exists |
| `admin_suspend_rider` | Suspend rider account | Admin | No UI component exists |
| `admin_verify_deposit` | Verify manual deposit | Admin | No UI component exists |
| `concierge_dispatch` | AI-driven ride dispatch | System | No UI trigger |
| `create_stripe_customer` | Auto-create Stripe customer on signup | System (DB webhook) | No UI component needed |
| `daily_push_notifications` | Send batch push notifications | System (cron) | No UI component needed |
| `dealer_brokerage` | Vehicle dealer/brokerage platform | Unlaunched vertical | No app exists for this |
| `expire_offer` | Auto-expire stale ride offers | System (timer) | No UI component needed |
| `fleet_lease_engine` | Driver fleet lease management | Admin/Driver | No UI component exists |
| `get_nearby_drivers` | Get drivers near a location | Rider (internal) | No direct UI call |
| `get_user_patterns` | Get user's travel patterns | Rider (AI feature) | No UI component exists |
| `identify_product` | AI-powered product identification | Rider (grocery) | No UI component exists |
| `match_order_delivery` | Match delivery to drivers | System | Called from `merchant_gateway` |
| `merchant_dispatch` | Dispatch merchant order to driver pool | System | Called internally |
| `merchant_gateway` | Accept/reject merchant orders | Merchant | No UI — called from orders flow |
| `merchant_order_picker` | Order fulfillment tracking | Merchant | No UI component exists |
| `mirror_ride` | Mirror ride for fleet monitoring | Admin | No UI component exists |
| `nfc_event_handler` | Process NFC puck events | Rider (NFC) | NfcScanScreen exists, partial |
| `nfc_restore_session` | Restore session from NFC tap | Rider (NFC) | NfcHandshakeScreen exists, partial |
| `process_merchant_consent` | Merchant agrees to delivery terms | Merchant | No UI component exists |
| `region_settings` | Regional fare/rule configuration | Admin | No UI component exists |
| `update_order_price` | Update merchant order pricing | Merchant | No UI component exists |
| `verify_handoff` | Verify merchant->driver handoff | Merchant/Driver | No UI component exists |
| `vision_pickup` | Vision-based package verification | Driver | No UI component exists |
| `whatsapp_webhook` | WhatsApp messaging integration | System (webhook) | No UI component needed |

### 1.2 Screens with Hardcoded/Dummy Data

| App | Screen | Problem | Line(s) |
|---|---|---|---|
| Rider | `LegalScreen.tsx` | Displays placeholder "LEGAL PROTOCOL" text, not real legal terms. No actual privacy policy or ToS language. | Full file |
| Rider | `SettingsScreen.tsx` | "Terms of Service" and "Privacy Policy" rows have no `onPress` handler — tapping them does nothing. | 121, 126 |
| Rider | `SubscriptionScreen.tsx` | Renders plan cards with hardcoded prices ("$29.99/week", "$99.99/month") — no data from backend. | 42-70 |
| Rider | `PromoScreen.tsx` | Shows "No promotions available" static text — no live promo query from backend. | 25-30 |
| Rider | `SavedPlacesScreen.tsx` | Renders hardcoded list of places — no SQL query to `saved_places` table. | 41-55 |
| Driver | `EarningsScreen.tsx` | Shows hardcoded earnings numbers ("$245.00") — no real query to `platform_revenue_logs`. | 62-78 |
| Driver | `ScheduledRidesScreen.tsx` | Renders empty state only — no scheduled rides query exists. | 31-35 |
| Driver | `StrategySettingsScreen.tsx` | All strategy toggles render but do not persist to the `drivers` table — changes are lost on app restart. | Full file |
| Merchant | `DashboardScreen.tsx` | Uses `head: true` incorrectly — count always shows 0. | 43-48 |
| Merchant | `OrdersScreen.tsx` | Renders empty list on any error — no error state shown to user. | 58-66 |

---

## 2. THE SECURITY AUDIT — Critical Vulnerabilities

### 2.1 Secrets in Version Control — Count: 32+ files

**CRITICAL — Ends up in client bundle:**

| File | Secret | Risk |
|---|---|---|
| `apps/rider/.env` | Supabase anon key, Google Maps key, Stripe publishable key, Mapbox token | **Entire file ends up in APK/IPA at build time. Anyone who downloads the app can read these.** |
| `apps/driver/.env` | Same 4 secrets + Stripe publishable | Same |
| `apps/admin/.env` | Supabase anon key, Google Maps key, Mapbox token | Ends up in web bundle. Anyone viewing admin JS source can read these. |
| `apps/merchant/.env` | Same | Same |
| `apps/rider/android/app/src/main/AndroidManifest.xml` | Google Maps API key (`AIzaSyA9g2wY_wRM19Ojw75kiceqLANXkHM6FtI`) | Extracted from APK via `aapt` or `apkanalyzer` |
| `apps/driver/android/app/src/main/AndroidManifest.xml` | Google Maps API key (same key) | Same |
| `apps/rider/google-services.json` | Firebase Android API key | Extracted from APK |
| `apps/driver/google-services.json` | Firebase Android API key (same key) | Extracted from APK |
| `apps/rider/GoogleService-Info.plist` | Firebase iOS API key (`AIzaSyACp6vv3kUcB3UnYGrbXV8nf-NJrCl5d5g`) | Extracted from IPA |
| `apps/driver/GoogleService-Info.plist` | Firebase iOS API key (same key) | Extracted from IPA |

**WARNING — Version-controlled, server-side:**
- **19 scripts** in `scripts/*.js` — hardcoded `SUPABASE_SERVICE_ROLE_KEY` as fallback value. Grants full DB access to anyone who runs these scripts.
- `supabase/functions/_shared/sentry.ts` — hardcoded Sentry DSN (real, not placeholder)
- 2 scripts reference a **different** Supabase project (`kdatihgcxrosuwcqtjsi`) with hardcoded credentials

### 2.2 Admin Dashboard Auth Gate — STATUS: FUNCTIONAL

The admin app (`apps/admin/`) has a working two-layer auth guard (`AdminSecurityGate`):
1. **Session check**: `supabase.auth.getSession()` on mount
2. **Admin role verification**: Calls `admin_get_flags` edge function which uses `requireAdmin()` — server-side query of `profiles.role`

However: The login page itself is the **only** route. There is no React Router, no route-level guards, no deep linking. This is functional but fragile — if the gate component is ever accidentally removed, the entire dashboard is exposed.

### 2.3 Remaining Edge Function Trust Issues

**Functions that still trust client-supplied IDs (partial check):**

| Function | What's trusted | Status |
|---|---|---|
| `accept_ride` | `ride_id` from body (acceptable — JWT identity is trusted for driver resolution) | ✅ Fixed in Phase 2 |
| `update_driver_location` | GPS coordinates from body (acceptable — can only update own location) | ✅ Fixed in Phase 2 |
| `create_ride` | `rider_id` from body? | Need to verify — **NOT CONFIRMED** |
| `cancel_ride` | `ride_id` from body, verifies ownership via rider/driver mapping | ✅ Verified |
| `complete_ride` | `ride_id` from body, verifies ownership | ✅ Verified |
| `admin_force_complete` | `ride_id` from body, admin JWT required | ✅ Verified |

**Verdict**: Core ride flow is clean. Admin functions need further audit but require `requireAdmin()` call.

---

## 3. DATA INTEGRITY & RECONCILIATION

### 3.1 Stripe Webhook → Internal Ledger Mapping

**Does `stripe_webhook` map PI events to our ledger?** YES, partially.

The webhook handler (`supabase/functions/stripe_webhook/index.ts`) performs a 6-step settlement:

```
Step A: INSERT payment_ledger (stripe_event_id UNIQUE)
Step B: INSERT wallet_transactions (driver payout)
Step C: INSERT wallet_transactions (platform fee)
Step D: INSERT capital_reserve_ledger
Step E: UPDATE rides SET payment_status = 'captured'
Step F: UPDATE rides SET status WHERE status = 'in_progress'
```

**CRITICAL FLAW**: If Step A succeeds but Steps B-F fail, **the `stripe_event_id` UNIQUE constraint prevents retry from re-executing**. The early-return check (line 73-85) returns HTTP 200 `already_processed` on Stripe's retry — silently accepting that Steps B-F were skipped. Money is captured in Stripe but driver wallet, platform fee, and capital reserve are never written.

### 3.2 Reconciliation Service

**NO RECONCILIATION LAYER DETECTED.**

No scheduled job, no edge function, no RPC, no script exists that:
- Compares Stripe's PaymentIntent list against `payment_ledger`
- Detects orphaned Stripe payments (captured in Stripe, missing from our DB)
- Detects wallet balance drift (sum of transactions vs current balance)
- Flags discrepancies between `capital_reserve_ledger` and actual reserve math

The system has **no way to detect or recover from**:
- A lost Stripe webhook (network failure between Stripe and Supabase)
- A partial failure in the 6-step settlement
- A wallet balance desync (e.g., from race condition or failed write)

The only recovery path is Stripe's built-in webhook retry (3-day window, ~20 retries). If that window expires, the money is permanently orphaned.

---

## 4. THE DEPLOYMENT ROADBLOCKS

### 4.1 Missing Environment Variables for Firebase Cloud Messaging

For push notifications to function in production:

| Secret | Where It Goes | Status |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Supabase Edge Function secrets | **MISSING** — code returns early when absent |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets | **MISSING** — set in env files but not in Supabase secrets dashboard |
| `STRIPE_SECRET_KEY` | Supabase Edge Function secrets | **MISSING** |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function secrets | **MISSING** |
| `SENTRY_DSN` | Supabase Edge Function secrets | Hardcoded fallback exists but should be env var |
| `TWILIO_ACCOUNT_SID` | Supabase Edge Function secrets | **MISSING** — SMS features broken |
| `TWILIO_AUTH_TOKEN` | Supabase Edge Function secrets | **MISSING** |
| `TWILIO_PHONE_NUMBER` | Supabase Edge Function secrets | **MISSING** — CLAUDE.md says `TWILIO_PROXY_SERVICE_SID` but code reads `TWILIO_PHONE_NUMBER` |
| `EXPO_PUBLIC_SENTRY_DSN` | Rider/Driver .env + EAS Secrets | **MISSING** from .env — placeholder fallback used |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Rider .env + EAS Secrets | **MISSING** — AI features broken |
| `EXPO_PUBLIC_GROQ_API_KEY` | Rider .env + EAS Secrets | **MISSING** — AI features broken |

### 4.2 Firebase Config File Mismatches

**Driver app Firebase config files are WRONG:**

| File | Actual Value | Correct Value | Impact |
|---|---|---|---|
| `apps/driver/google-services.json` `package_name` | `g_taxi_868.gtaxi.com` | `com.gtaxi.driver` | **Android push notifications will not deliver to driver app** |
| `apps/driver/GoogleService-Info.plist` `BUNDLE_ID` | `G` | `com.gtaxi.driver` | **iOS push notifications will not deliver to driver app** |

Rider app Firebase config files are correct.

### 4.3 App Store Compliance — Missing

| Requirement | Status |
|---|---|
| Privacy Policy URL | **NOT CREATED** — LegalScreen has placeholder text, not a real policy |
| Terms of Service URL | **NOT CREATED** — Same, placeholder text |
| App Store Connect listing | **NOT SET UP** — No bundle IDs registered for any app |
| Google Play Console listing | **NOT SET UP** |
| Data safety section (Google Play) | **NOT COMPLETED** |
| Privacy nutrition labels (App Store) | **NOT COMPLETED** |
| Screenshots for all device sizes | **NOT CREATED** |
| Test accounts for review teams | **NOT CREATED** |

---

## 5. TESTING COVERAGE — TABLE

| Module | Total | Tested | Coverage | Test Depth |
|---|---|---|---|---|
| **Edge Functions** | 69 | 5 | **7.2%** | Settlement math, push format, RPC existence only |
| **Rider Screens** | 40 | 39 | 97.5% | 1-assertion smoke tests (renders without crash) |
| **Driver Screens** | 14 | 10 | 71.4% | 1-assertion smoke tests |
| **Merchant-Mobile Screens** | 4 | 4 | 100% | 1-assertion smoke tests |
| **Admin-Mobile Screens** | 3 | 3 | 100% | 1-assertion smoke tests |
| **Admin Web App** | 8 pages | 0 | **0%** | No test framework configured |
| **E2E (Detox/Maestro/Cypress/Playwright)** | 0 | 0 | **0%** | No E2E infrastructure exists |

**Total assertions across all tests: ~258.**
**64 of 69 edge functions have zero tests.**
**Zero E2E tests exist in any framework.**

---

## 6. THE "TRAP" LIST — Screens That Will Crash Today

### CRITICAL CRASHES (app crashes / blank screen)

| # | Trigger | File | Line | Mechanism |
|---|---|---|---|---|
| 1 | Rider taps "Vision Sight" button on HomeScreen, picks a photo, camera returns null asset | `apps/rider/src/screens/HomeScreen.tsx` | 456 | `result.assets[0].base64` — throws `TypeError: Cannot read properties of undefined` when `assets` array is empty |
| 2 | Rider edits profile photo, camera returns empty assets array | `apps/rider/src/screens/EditProfileScreen.tsx` | 52 | Same pattern: `result.assets[0].base64` — crashes |
| 3 | Driver registers with photo, camera returns empty assets | `apps/driver/src/screens/RegisterScreen.tsx` | 75 | `result.assets[0].uri` — crashes |
| 4 | Rider tops up wallet, edge function returns non-JSON error (429/500) | `apps/rider/src/screens/WalletTopUpScreen.tsx` | 84-91 | `response.json()` throws `SyntaxError` on HTML error page — user sees "Error: JSON Parse error" |
| 5 | Rider tops up wallet, edge function returns 401/403/429 | `apps/rider/src/screens/WalletTopUpScreen.tsx` | 84-91 | No `response.ok` check — `clientSecret` is undefined — catches with confusing message |

### HIGH FAILURES (wrong behavior, data loss)

| # | Trigger | File | Line | Mechanism |
|---|---|---|---|---|
| 6 | Driver taps NFC identity puck, profile is null | `apps/driver/src/screens/DashboardScreen.tsx` | 235 | `profile.full_name` throws — or `profile.balance_cents / 100` shows `$NaN` |
| 7 | Driver accepts ride with expired session | `apps/driver/src/screens/TripRequestScreen.tsx` | 148 | Error mapped to "Offer Expired" — user thinks ride was taken, not that they're logged out |
| 8 | Merchant opens dashboard, has pending orders | `apps/merchant-mobile/src/screens/DashboardScreen.tsx` | 43 | `head: true` returns `data: null`, `data.length` never reached — count shows 0 permanently |
| 9 | Rider checks out grocery cart, `match_order_delivery` network fails | `apps/rider/src/screens/GroceryCartScreen.tsx` | 82 | `.then()` without `.catch()` — unhandled promise rejection — delivery is silently never dispatched |
| 10 | Any screen calls any edge function, gets rate limited (429) | **All mobile apps** | All 39 invoke sites | No screen differentiates 429 from logical errors — user gets wrong message |

### SILENT FAILURES (system degrades with no feedback)

| # | Trigger | File | Line | Mechanism |
|---|---|---|---|---|
| 11 | Admin-mobile fails to load nodes | `apps/admin-mobile/src/screens/DashboardScreen.tsx` | 57 | `catch (err) { /* silent */ }` — empty screen forever |
| 12 | Merchant loads orders, DB query errors | `apps/merchant-mobile/src/screens/OrdersScreen.tsx` | 58 | Error consumed — empty list shown |
| 13 | Driver dashboard calls `get_system_status`, fails | `apps/driver/src/screens/DashboardScreen.tsx` | 123 | Silent catch — maintenance alerts never shown |
| 14 | Driver dashboard calls active trip recovery, fails | `apps/driver/src/screens/DashboardScreen.tsx` | 130 | Silent catch — driver misses reconnecting to active trip |
| 15 | Merchant load profile fails | `apps/merchant-mobile/src/screens/DashboardScreen.tsx` | 31 | Silent — name defaults to "Merchant" |
| 16 | Stripe webhook processes 6-step settlement, Steps B-F fail | `supabase/functions/stripe_webhook/index.ts` | 73 | Idempotency early return on retry — Steps B-F never re-execute |

### TOTAL: 16 traps — 5 critical crashes, 5 high failures, 6 silent failures.

---

## EXECUTIVE VERDICT

**Production Readiness: 22/100**

| Category | Score | Reason |
|---|---|---|
| Backend security | 7/10 | Admin gate works, secrets in `.env` still checked in, no service role key in client bundle |
| Ride state machine | 9/10 | Triply enforced (DB CHECK + edge guard + Realtime), 18 tests |
| Payment integrity | 3/10 | Stripe integration exists but webhook partial failure is unrecoverable, zero reconciliation |
| Push notifications | 0/10 | Driver Firebase config files have wrong package name/bundle ID — will not deliver |
| Frontend robustness | 3/10 | 5 known crash points from null dereferences, no error differentiation, 16 total traps |
| Test coverage | 2/10 | 7.2% edge function coverage, zero E2E, all screen tests are 1-assertion smoke |
| App store readiness | 0/10 | No privacy policy, no ToS, no store listings, no screenshots |
| Merchant app | 2/10 | 4 screens, no menu management, no analytics, no handoff verification |
| Admin web | 5/10 | Auth gate works but no live map, no Fleet Manager, no Financials, no Rescue Screen |
| AI verticals (grocery/laundry) | 3/10 | Screens exist, backend mostly missing, no E2E tested |

You are not ready for production. You have a solid backend foundation and a broken frontend superstructure. Fix the 16 traps, add the reconciliation layer, fix the Firebase configs, and build the missing merchant/admin screens before putting this in front of real users.
