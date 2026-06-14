# G-TAXI SYSTEM HANDOFF

**Generated:** 2026-06-13  
**Context:** Full-codebase audit + WiPay payment layer + referral bug fix + orphan cleanup completed.  
**System state:** All 138+ migrations applied, 64 edge functions deployed (9 orphans deleted), DB current.

---

## WHAT WAS DONE THIS SESSION

| Task | Detail |
|---|---|
| WiPay payment layer | Edge functions (`create_wipay_payment`, `wipay_webhook`), `wipay_sessions` table, state machine update, complete_ride patched, rider PaymentScreen updated |
| Referral commission fix | `check_driver_referral_commission` — changed `AND status = 'paid'` to `AND status = 'active'` |
| Migration audit | Compared 139 local files vs 166 DB-applied — only 1 truly unapplied (RLS fix), content verified already in DB |
| Orphaned functions | Deleted 9: auto-match-bot, check_push_status, fleet_lease_engine, merchant_dispatch, process_driver_payout, process_merchant_consent, region_settings, update_order_price, confirm_ride_payment |
| Edge function secrets | Set: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, FIREBASE_SERVICE_ACCOUNT_JSON, WIPAY_ACCOUNT_NUMBER, WIPAY_ENVIRONMENT, WIPAY_API_URL |

---

## REMAINING WORK

### 1. Twilio Secrets (blocks SMS)
Get from Twilio console and set via:
```bash
supabase secrets set TWILIO_ACCOUNT_SID=<your_sid>
supabase secrets set TWILIO_AUTH_TOKEN=<your_token>
supabase secrets set TWILIO_PHONE_NUMBER=<+1868xxxxxxx>
```

### 2. WiPay Live Key
When WiPay business account is approved:
```bash
supabase secrets set WIPAY_ACCOUNT_NUMBER=<live_account_number>
supabase secrets set WIPAY_ENVIRONMENT=live
```

### 3. `driver_loans` Table + Admin Deploy RPC
Reserve accumulates in `capital_reserve_ledger` with no deployment path.  
Needed: `driver_loans` table + admin RPC `admin_deploy_from_reserve`.  
Location: `supabase/migrations/` (create new file).

### 4. EAS Build for Rider + Driver + Merchant Apps
```bash
cd apps/rider && eas build --platform android
cd apps/driver && eas build --platform android
cd apps/merchant-mobile && eas build --platform android
```
Pre-requisite: set `EXPO_PUBLIC_*` env vars in EAS.

### 5. Add `expo-notifications` Plugin to Rider Config
File: `apps/rider/app.config.js`  
Missing: `"expo-notifications"` in `plugins` array.  
Driver config has it (line 72) — copy pattern.

### 6. Auth for `identify_product` + `vision_pickup`
File: `supabase/functions/identify_product/index.ts`, `supabase/functions/vision_pickup/index.ts`  
Both have `verify_jwt = false` and no JWT check in function body.  
Add JWT validation using `requireDriver()` or `requireAuth()` pattern from `_shared/auth.ts`.

### 7. Referral `driver_qualifies_loyalty_rate` Logic Review
File: `supabase/migrations/20260612200000_rockefeller_compounding_layer.sql:313-319`  
Function: `driver_qualifies_loyalty_rate`  
Checks `SUM(amount) >= 50000` across ALL `wallet_transactions` — includes debits. A driver with $500 earned but $100 withdrawn still qualifies ($400 net). May intend lifetime earnings, not net balance. Review with stakeholder.

### 8. Stripe Keys — Deprecation Decision
Current `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are test keys.  
If Stripe won't serve T&T users, consider removing Stripe integration entirely and using WiPay as sole processor. Otherwise, get live Stripe keys.

---

## KEY FILES REFERENCE

| Area | File |
|---|---|
| WiPay payment creation | `supabase/functions/create_wipay_payment/index.ts` |
| WiPay webhook handler | `supabase/functions/wipay_webhook/index.ts` |
| WiPay DB sessions table | `supabase/migrations/20260613_wipay_payment_layer.sql` |
| Complete ride handler | `supabase/functions/complete_ride/index.ts:336` |
| Rider payment screen | `apps/rider/src/screens/PaymentScreen.tsx` |
| Ride state machine (DB) | `supabase/migrations/20260227000001_phase8_state_machine.sql` |
| Payment safety check (DB) | `supabase/migrations/20260519094932_phase3_crash_fixes.sql` |
| Referral RPC (fixed) | `supabase/functions/complete_ride/index.ts:462-471` |
| Referral RPC definition | `supabase/migrations/20260612200000_rockefeller_compounding_layer.sql:281-310` |
| Push notifications | `supabase/functions/_shared/push.ts` |
| SMS | `supabase/functions/_shared/sms.ts` |
| Redis caching | `supabase/functions/_shared/redis.ts` |
| Settlement engine | `supabase/functions/complete_ride/index.ts` |
| Rider app package | `apps/rider/package.json` |
| Rider app config | `apps/rider/app.config.js` |
| Driver app config | `apps/driver/app.config.js` |

---

## EDGE FUNCTION SECRETS STATUS

```
SUPABASE_ANON_KEY              ✅ Set
SUPABASE_SERVICE_ROLE_KEY      ✅ Auto-injected by Supabase
STRIPE_SECRET_KEY              ✅ Set (test key)
STRIPE_WEBHOOK_SECRET          ✅ Set (test key)
SENTRY_DSN                     ✅ Set
GROQ_API_KEY                   ✅ Set
GEMINI_API_KEY                 ✅ Set
FIREBASE_SERVICE_ACCOUNT_JSON  ✅ Set (base64 encoded)
UPSTASH_REDIS_REST_URL         ✅ Set
UPSTASH_REDIS_REST_TOKEN       ✅ Set
WIPAY_ACCOUNT_NUMBER           ✅ Set (sandbox 1234567890)
WIPAY_ENVIRONMENT              ✅ Set (sandbox)
WIPAY_API_URL                  ✅ Set (https://tt.wipayfinancial.com/plugins/payments/request)
TWILIO_ACCOUNT_SID             ❌ MISSING — blocks SMS
TWILIO_AUTH_TOKEN              ❌ MISSING — blocks SMS
TWILIO_PHONE_NUMBER            ❌ MISSING — blocks SMS
```

---

## RESOURCES FOR NEXT AGENT

### Supabase Links
- Edge function secrets: https://supabase.com/dashboard/project/ffbbuafgeypvkpcuvdnv/settings/edge-functions
- Database: https://supabase.com/dashboard/project/ffbbuafgeypvkpcuvdnv/sql
- Edge functions: https://supabase.com/dashboard/project/ffbbuafgeypvkpcuvdnv/functions

### External Service Links
- Twilio: https://console.twilio.com
- WiPay dashboard: https://wipaycaribbean.com (need business account)
- Stripe: https://dashboard.stripe.com
- Firebase: https://console.firebase.google.com
- EAS: https://expo.dev/accounts/{account}/projects

### Monitor Logs
```bash
supabase logs --service edge-function
supabase logs --service postgres
```

---

## CRITICAL RULES FOR ANY AGENT

1. Never put `SUPABASE_SERVICE_ROLE_KEY` in any client bundle (`apps/rider/`, `apps/driver/`, `apps/admin/src/`).
2. Edge functions must resolve user identity from JWT via `auth.getUser()` — never trust client-supplied IDs.
3. DB connections from edge functions use port 6543 (transaction pooler), not 5432.
4. Wallet deductions use `SELECT FOR UPDATE` inside `BEGIN/COMMIT`.
5. Stripe webhook handlers verify signature using raw request body (`req.text()` before JSON parse).
6. Do not modify RLS policies without reading the full RLS rules in AGENTS.md first.
7. Every output must be a complete file — never partial snippets.
8. Read AGENTS.md at project root before making any changes.
