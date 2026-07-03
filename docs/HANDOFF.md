# HANDOFF — G-Taxi Caribbean Super-App

**Date:** 2026-06-14
**From:** Opencode session (cleanup + strategy audit)
**To:** Any AI agent continuing this work
**Repo:** `gtaxi868-kingtay/G-Taxi-868-R1-`
**Branch:** `main` (commit `1a4bc388`)

---

## WHAT THIS THING ACTUALLY IS

NOT a taxi app. A multi-vertical super-app platform for Trinidad, Tobago, and broader Caribbean:
- Ride-hailing core (the foundation)
- Grocery delivery (unlocked at rider Level 2)
- Laundry pickup (unlocked at rider Level 3)
- Food delivery (built, admin-toggleable, not yet wired to navigation)
- Merchant service appointments (NFC tap → book)
- Caribbean travel packages (flight + hotel bundling)
- G-Escape (crowdfunded vacation packages)
- NFC kiosk tap network (physical pucks at merchants)
- Driver BYD lease program (90-day qualify → per-ride installments)
- Capital reserve / War Chest (1.5% of every fare)
- Rider subscriptions (free/plus/pro tiers)
- Merchant subscriptions ($150/mo after 90-day trial)
- AI concierge (proactive suggestions, natural language, vision pickup)

---

## WHERE THE KEY CODE LIVES

### Ride-hailing engine (the core loop)
- `supabase/functions/create_ride/index.ts` — Ride creation with atomic RPC, rate limited
- `supabase/functions/accept_ride/index.ts` — Driver accepts via JWT (never trust client driver_id)
- `supabase/functions/match_driver/index.ts` — Nearest driver with `SKIP LOCKED`
- `supabase/functions/complete_ride/index.ts` — Finalize, 81/19 split, reserve contribution
- `supabase/functions/estimate_fare/index.ts` — $16 base + $0.95/min + $1.75/km, $22 min
- `supabase/functions/cancel_ride/index.ts` — State machine transition enforcement
- `apps/rider/src/screens/ActiveRideScreen.tsx` — Main live ride screen

### Rider progression (gated ecosystem unlock)
- `supabase/migrations/20260530000001_rider_progression.sql` — Level table, thresholds
- Level 1: rides | Level 2: grocery (5 rides) | Level 3: laundry/NFC (2 grocery) | Level 4: wallet bonus (1 laundry) | Level 5: G-Escape (wallet funded)
- `get_home_suggestion` RPC — Contextual home screen CTA
- `record_rider_activity()` RPC — Atomic level-up evaluation
- NOT YET WIRED: `get_home_suggestion` not called in HomeScreen yet

### Grocery delivery
- `apps/rider/src/screens/GroceryStorefrontScreen.tsx`
- `apps/rider/src/screens/GroceryCartScreen.tsx`
- `apps/rider/src/screens/GroceryOrderStatusScreen.tsx`
- `apps/rider/src/screens/ProductListingScreen.tsx`
- `apps/rider/src/screens/ProductDetailScreen.tsx`
- `apps/rider/src/screens/VisionScannerScreen.tsx` — AI product camera scan
- `supabase/functions/match_order_delivery/index.ts`
- `supabase/functions/identify_product/index.ts`

### Laundry
- `apps/rider/src/screens/LaundryLandingScreen.tsx`
- `apps/rider/src/screens/LaundryEstimatorScreen.tsx` — AI photo item count
- `apps/rider/src/screens/LaundryOrderStatusScreen.tsx`

### Food delivery (BUILT, NOT WIRED)
- `apps/rider/src/screens/FoodDeliveryScreen.tsx` — Full screen with filters, search
- NOT registered in `apps/rider/src/App.tsx` navigator
- Vertical: `food_delivery` in `vertical_settings` (disabled)

### G-Escape (vacation crowdfunding)
- `supabase/migrations/20260530000003_escape_crowdfunding.sql`
- `supabase/functions/book_escape/index.ts` — Atomic booking, FOR UPDATE, Stripe pre-auth
- `supabase/functions/confirm_escape_payment/index.ts`
- `apps/rider/src/screens/EscapeStorefrontScreen.tsx` — EXISTS, NOT wired to App.tsx
- `apps/rider/src/screens/ActivePassScreen.tsx`
- Pricing: C_flight + C_lodging + F_driver_origin + F_driver_destination + M_platform (19%) + loyalty_rebate (3%)

### Caribbean travel packages
- `apps/rider/src/screens/TravelStorefrontScreen.tsx`
- `apps/rider/src/screens/TravelPackageDetailScreen.tsx`
- `apps/rider/src/screens/TravelBookingConfirmationScreen.tsx`
- `apps/rider/src/screens/TravelMyBookingsScreen.tsx`
- `supabase/functions/get_travel_packages/index.ts`
- `supabase/functions/generate_travel_packages/index.ts`

### NFC kiosk network
- `apps/rider/src/screens/NfcScanScreen.tsx`
- `apps/rider/src/screens/NfcHandshakeScreen.tsx`
- `apps/rider/src/screens/TagMarkerScreen.tsx`
- `apps/rider/src/screens/ServiceBookingScreen.tsx`
- `supabase/functions/nfc_event_handler/index.ts`
- `packages/core/src/nfcRouter.ts`
- `packages/core/src/outbox.ts`
- NFC dispatch migration NOT YET APPLIED: `20260530000005_nfc_dispatch_layer.sql`

### Driver BYD lease program
- `apps/driver/src/screens/LeaseScreen.tsx`
- `apps/driver/src/screens/VehicleSalesScreen.tsx`
- `supabase/functions/driver_lease_status/index.ts`
- `supabase/functions/dealer_brokerage/index.ts`
- `apps/admin/src/pages/FleetManager.tsx`
- `apps/admin/src/pages/DealerBrokerage.tsx`
- Lease deduction: 15% gross per ride cap, idempotent via `deduct_lease_installment_for_ride()`

### Capital reserve (War Chest)
- `apps/admin/src/pages/WarChest.tsx`
- 1.5% of every card ride gross fare BEFORE 81/19 split
- Target: TTD $500,000 (50,000,000 cents)
- `capital_reserve_ledger` table — immutable
- `reserve_health` singleton row

### Rider subscriptions
- Tiers: free (0%), plus ($9.99/mo, 10% off), pro ($19.99/mo, 15% off, priority)
- `profiles.subscription_tier` column
- `subscription_benefits` table
- `calculate_subscription_discount()` RPC
- UI NOT YET consuming the subscription logic

### Merchant subscriptions
- `merchant_subscriptions` table: trial (90 days) → active → overdue → suspended → cancelled
- `auto_create_merchant_subscription()` trigger
- `process_merchant_billing()` daily pg_cron
- `apps/admin/src/pages/MerchantNetwork.tsx` — Full subscription management UI

### AI concierge & intelligence
- `supabase/functions/ai_concierge_proactive/index.ts` — Time-of-day/location suggestions
- `supabase/functions/parse_natural_language/index.ts` — "Take me from X to Y"
- `supabase/functions/vision_pickup/index.ts` — Camera-based location
- `supabase/functions/generate_ai_greeting/index.ts`
- `supabase/functions/platform_intelligence/index.ts` — Groq llama3.3-70b, 15-min cycle
- `supabase/functions/update_user_memory/index.ts`
- `supabase/functions/get_user_patterns/index.ts`
- `supabase/functions/suggest_stops/index.ts`
- `supabase/functions/ai_suggest_stops/index.ts`
- `apps/rider/src/screens/AISettingsScreen.tsx`
- `apps/rider/src/components/AIAssistantWidget.tsx`
- `apps/admin/src/pages/Intelligence.tsx`

### Payment systems
- `supabase/functions/stripe_webhook/index.ts` — Signature verify using RAW body
- `supabase/functions/create_payment_intent/index.ts`
- `supabase/functions/create_wallet_topup/index.ts`
- `supabase/functions/create_wipay_payment/index.ts`
- `supabase/functions/wipay_webhook/index.ts`
- `supabase/functions/request_payout/index.ts`
- `supabase/functions/admin_process_payout/index.ts`

### Admin dashboard
- `apps/admin/src/App.tsx` — All routes listed. AdminSecurityGate at line 18.
- 15+ pages: Dashboard, FleetManager, Financials, DriverApproval, NodeRegistry, RescueScreen, WarChest, PlatformControl, TravelPackages, DealerBrokerage, Intelligence, MerchantNetwork, Pricing, Support, Login

### Feature flags (vertical_settings + admin_toggle_flag)
- Flags: driver_registration_active, promo_codes_active, grocery_active, laundry_active, ai_assistant_active, kiosk_active, airline_active, hotel_active
- `supabase/functions/admin_toggle_flag/index.ts`
- `supabase/functions/admin_get_flags/index.ts`
- `apps/admin/src/pages/PlatformControl.tsx`

---

## WHAT NEEDS TO HAPPEN NEXT

### IMMEDIATE (pre-launch)

1. **Set Supabase edge function secrets** (dashboard only, NEVER in code):
   - SUPABASE_SERVICE_ROLE_KEY
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN (free tier, replaces Twilio)
   - FIREBASE_SERVICE_ACCOUNT_JSON (base64)
   - SENTRY_DSN
   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

2. **Wire unregistered screens to App.tsx:**
   - `FoodDeliveryScreen` — add to navigator
   - `EscapeStorefrontScreen` — add to navigator

3. **Wire rider progression UI:**
   - Call `get_home_suggestion()` RPC from HomeScreen
   - Show unlock notifications when rider levels up

4. **Apply NFC dispatch migration:**
   - `supabase/migrations/20260530000005_nfc_dispatch_layer.sql`

5. **Add expo-notifications plugin to rider app.config.js**
   (driver app.config.js already has it at line 72)

### LAUNCH

1. **EAS Build APK** — `eas build --platform android --profile production`
2. **Test full flow:** Book ride → match → track → complete → pay → rate
3. **Test at least one vertical unlock** (grocery after 5 rides)
4. **Cash vs card payment** — both must work end to end
5. **Driver KYC flow** — driver approval → go online → accept ride

### FINANCE MANAGEMENT

1. **Stripe pricing** — ensure live keys, not test keys
2. **Driver payout schedule** — `request_payout` + `admin_process_payout` edge functions handle this
3. **Capital reserve contributions** — verify 1.5% deduction works in complete_ride
4. **Wallet top-up flow** — tested end to end (WiPay + Stripe)
5. **Merchant subscription billing** — pg_cron job running

### LEGAL & OPERATIONS

1. **T&T ride-hailing regulation** — gray area. Need legal opinion on:
   - T&T Ministry of Works & Transport - Public Service Vehicle licensing
   - Insurance requirements for ride-hailing (comprehensive + third party)
   - Driver contracts (contractor vs employee)
   - Data protection compliance (T&T Data Protection Act 2023)
2. **Driver lease agreement** — for BYD fleet program
3. **Merchant terms of service** — for delivery/subscription
4. **Rider terms & privacy policy** — with AI concierge data usage disclosure

### DEALER CONTRACTS

The user wants to approach car dealerships (not BYD only) to supply vehicles for the driver fleet program. What needs building:
- Fleet vehicle inventory management (already built — `fleet_vehicles` table, `dealer_brokerage` function)
- Contract templates per dealer (not yet built — needs legal)
- Per-vehicle lease terms config (partially built in `fleet_leases` table)
- Multi-dealer reconciliation (not yet built — dealer needs periodic payout)

---

## ARCHITECTURAL RULES (DO NOT BREAK)

1. **Supabase service role key** lives ONLY in edge function secrets. Never in any client app.
2. **Edge functions resolve identity from JWT** — `auth.getUser()` with Bearer token from `Authorization` header. Never trust client-supplied IDs.
3. **DB connections from edge functions** use transaction pooler on port **6543**, not 5432.
4. **Wallet deductions** use `SELECT FOR UPDATE` inside explicit `BEGIN/COMMIT`.
5. **Stripe webhook** must verify signature using **raw request body** — call `req.text()` before any JSON parsing.
6. **Ride state machine** is enforced: `searching → assigned → arrived → in_progress → completed → payment_confirmed → closed`. Never skip states.
7. **RLS** on profiles: own profile only, driver sees only currently assigned rider, rider sees only currently assigned driver. No public reads.
8. **payment_ledger** table: SELECT only for users, INSERT only via service role. No UPDATE/DELETE.

---

## FILES THAT GUIDE AI AGENTS (KEEP THESE)

- `AGENTS.md` — Full system rules, RLS, state machine, env required
- `CLAUDE.md` — Short-form agent instructions
- `PRODUCT.md` — Product description
- `COMPLIANCE_CHECKLIST.md` — Compliance tracking
- `docs/HANDOFF.md` — This file
- `docs/agents/` — Agent configuration (domain, issue tracker, triage labels)

---

## SUGGESTED TOOLS/SKILLS FOR NEXT AGENT

- **supabase** skill — for any Supabase work (migrations, edge functions, RLS, auth)
- **diagnose** skill — for debugging production issues
- **review** skill — for reviewing PRs/changes
- **design-an-interface** skill — for designing dealer contract interfaces
- **impeccable** skill — for UI polish and rider visual experience
