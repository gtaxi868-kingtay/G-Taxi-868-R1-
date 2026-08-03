# G-TAXI — CLAUDE CODE CONTEXT
# Read this entire file before touching any code.
# Do not skip sections. Do not assume you know the state of any file.
# Do not fix multiple phases in one session unless explicitly told to.

# Last updated: 2026-07-16
# Plain English summary (based on code in this repo):
# This repository implements a multi-vertical platform for Trinidad and
# Tobago built on a ride-hailing core: rides, grocery/merchant delivery,
# G-Escape (group flight+lodging packages), a franchise "grid" of
# commander-recruited merchant/kiosk nodes, and G — an AI chief-of-staff
# that proposes actions for admin approval but never auto-executes money.
# Apps: Rider, Driver, Merchant, Admin (web + mobile), QR-landing.
# Expo SDK 52 for mobile; admin is Vite/React. Backend is Supabase
# (Postgres + PostGIS + pg_cron) with 130+ Deno edge functions.

# IMPORTANT: This file was 33 days stale before 2026-07-16. A single
# session that night found and fixed 8+ real crash bugs in money-moving
# code that had NEVER been exercised by a real transaction (0 wallet
# transactions existed in production before that session's dry-run
# tests) — every one verified live before/after via rolled-back
# transactions. Read `git log` for the real sequence; do not trust any
# status claim in this file without re-verifying against current code,
# the same discipline that found those bugs in the first place.

---

## WHAT THIS SYSTEM IS

A multi-vertical platform for Trinidad and Tobago, ride-hailing at its core.

Components:
- Rider mobile app:      apps/rider/          (Expo/React Native/TypeScript)
- Driver mobile app:     apps/driver/         (Expo/React Native/TypeScript)
- Merchant mobile app:   apps/merchant-mobile/(Expo/React Native/TypeScript)
- Merchant web app:      apps/merchant/       (Vite/React/TypeScript)
- Admin dashboard:       apps/admin/          (Vite/React/TypeScript)
- Admin mobile app:      apps/admin-mobile/   (Expo/React Native/TypeScript)
- QR landing/front door: apps/qr-landing/     (static)
- Edge functions:        supabase/functions/  (Deno/TypeScript — 130+ functions)
- Database:              Supabase Postgres with PostGIS, RLS enabled, 130+ migrations
- Maps:                  Mapbox
- Auth:                  Supabase Auth (email/password)
- Realtime:              Supabase Realtime WebSocket subscriptions
- AI:                    Groq (llama-3.3-70b) via `_shared/llm.ts`, provider-swappable (xAI supported)

---

## PRODUCTION STATUS (verified 2026-07-16)

  PRODUCTION READY:        NO  — Stripe keys not set; 0 verified drivers, 1 distinct rider ever
  SAFE FOR REAL MONEY:     YES, as of 2026-07-16 — all three payment paths (cash/wallet/card)
                            now share one settlement source of truth (compute_ride_split),
                            verified live end-to-end for the first time in this system's history
  Real transaction volume: ZERO — every fix below closed a bug that had never fired because
                            no real payment had ever completed. Design review, not a business result.
  Commander revshare:      Was structurally broken since it was written — queried a table
                            (profiles) drivers never get a row in. Fixed via drivers.territory_id.
  Grid/nodes:              Schema is real; the human network is not — 1 active commander, 14
                            drivers (mostly test/seed), every live kiosk node's tag_uid is NULL
                            (no physical hardware provisioned yet).

---

## EDGE FUNCTION SECRETS — STATUS AS OF 2026-07-16, SOURCED FROM CODE NOT NOTES

A prior version of this section was stale (listed Twilio, which is used
NOWHERE in the code — messaging runs on WhatsApp Business API instead —
and omitted several vars the code genuinely depends on). This list was
built by grepping every `Deno.env.get(...)` call across `supabase/functions/`.

  AUTO-INJECTED BY SUPABASE RUNTIME (never set manually):
  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

  ACTUALLY FATAL IF MISSING (crashes the function at cold start, not just degrades):
  - STRIPE_SECRET_KEY        ❌ create_payment_intent, create_stripe_customer,
                               create_wallet_topup, audit_stripe_vs_ledger, grocery
                               all crash at module load (Stripe SDK throws on non-string key)
  - STRIPE_WEBHOOK_SECRET    ❌ stripe_webhook crashes at module load via requireEnv()

  GRACEFUL DEGRADE IF MISSING (function loads, feature just doesn't work — confirmed by
  reading the actual fallback code, not assumed):
  - WIPAY_ACCOUNT_NUMBER / WIPAY_API_KEY   — WiPay card payments return `coming_soon`
  - WIPAY_ENV / WIPAY_ENVIRONMENT           — defaults to sandbox (note: two DIFFERENT var
                                              names used inconsistently across WiPay functions)
  - WIPAY_WEBHOOK_SECRET                    — WiPay webhook callbacks can't self-authenticate
                                              (admin-JWT calls still work)
  - FIREBASE_SERVICE_ACCOUNT_JSON           — push notifications silently fail to send (logged)
  - WHATSAPP_PHONE_NUMBER_ID / ACCESS_TOKEN — falls back to wa.me deep links
  - SENTRY_DSN                              — error reporting silent, fully wrapped in try/catch
  - UPSTASH_REDIS_REST_URL / TOKEN          — cache layer no-ops, falls through to DB
  - GROQ_API_KEY                            — AI features (NL parsing, concierge, platform
                                              intelligence, AI greetings) fall back to templates
  - AMADEUS_API_KEY / AMADEUS_API_SECRET    — G-Escape flight availability sync fails
  - BOOKING_API_KEY                         — G-Escape lodging availability sync fails
  - GEMINI_API_KEY                          — product photo ID / vision pickup fail per-request
  - PLATFORM_CRON_SECRET                    — every pg_cron-triggered job becomes unreachable
                                              (16 functions depend on this — settlement, payouts,
                                              dispatch queue, G departments, flight/lodging sync)
  - MAPBOX_ACCESS_TOKEN / MAPBOX_PUBLIC_TOKEN — two different var names, some functions check
                                              one then fall back to the other; geocoding fails silently
  - WARM_BRAIN_URL                          — wallet-balance/driver-proximity cache disabled,
                                              falls through to direct DB queries

  NOT USED ANYWHERE IN CODE (remove from any secrets checklist):
  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PROXY_SERVICE_SID

---

## SESSION LOG — 2026-07-16 (one long session, see git log for exact commits)

The prior CLAUDE.md's crash/hole list from 2026-06-13 was still accurate
as far as it went — this session found a DIFFERENT, later layer of bugs
in code written or touched between 2026-06-13 and 2026-07-16, all in
money-moving paths that had never been exercised by a real transaction.
Every fix below was verified live in a rolled-back Postgres transaction
before being applied for real, and re-verified after.

1. **Driver identity bug (P0)**: `process_wallet_payment_hardened` (wallet
   rides) and `process_driver_settlement_atomic` (card rides) credited
   `wallet_transactions.user_id = rides.driver_id` — but `rides.driver_id`
   is `drivers.id`, not the driver's auth id. Money was correctly debited
   from riders and permanently unreachable by the driver who earned it.
2. **Commander revshare never fired, ever, on any payment method**:
   `compute_ride_split` looked up the commander via
   `profiles.referred_by_commander_id` keyed on the driver's auth id —
   but drivers never get a `profiles` row in this system (13 of 14 live
   drivers confirmed with zero matching row). Real relationship is
   `drivers.territory_id → pod_commanders.territory_id`.
3. **G-Escape platform fee was refunded to the paying rider**:
   `charge_escape_participant_wallet` credited BOTH the rider debit AND
   the "platform fee" to the same `p_rider_id` — the platform had
   collected TT$0 on every group escape payment, ever.
4. **Node-rent fraud vector**: `create_ride` trusted a client-supplied
   `kiosk_id` with zero verification — any request could redirect real
   merchant commission to an arbitrary node. Fixed with
   `verify_kiosk_origin()` (real NFC tap in last 30 min, or geofence).
5. **~10 CHECK-constraint / nonexistent-column crashes** across
   `process_wallet_payment_hardened`, `process_driver_settlement_atomic`,
   `capture_escape_wallet_payment`, `admin`'s `settle_debt` action — all
   inherited verbatim from code nobody had ever run against a real
   payment (wrong column names like `amount_cents`/`metadata` instead of
   `amount`/`reference_id`, invalid `transaction_type` enum values).
6. **Two entirely disconnected G-Escape booking systems found live in
   production simultaneously** — `flight_blocks`/`package_reservations`
   (the one riders actually book through, auto-confirmed by a cron with
   zero admin visibility) and `escape_group_participants` (older,
   disconnected, but the ONLY system the existing admin UI —
   `apps/admin/src/pages/EscapeManagement.tsx` — actually controls).
   Fixed by giving admin real final control over the live system via the
   existing `g_proposed_actions` approval-inbox pattern, with an
   automatic release fallback (full capacity, or departure within 24h)
   so nothing is ever lost to admin inaction.
7. **Settlement v3**: merchant node "rent" unified to 2% of the
   platform's take (not gross fare — closed a 1%-vs-5% inconsistency
   between cash and card paths); type-based/per-merchant-override pin
   fees; merchant self-service rider-discount opt-in; reserve-funded
   referral kickbacks (driver-onboards-rider 5%, rider-onboards-rider
   3%, both structurally incapable of touching driver/platform margin —
   verified by testing against a genuinely empty reserve, which correctly
   refused to pay rather than manufacture money).
8. **Admin-controlled vehicle classes**, including heavy vehicles
   (truck/hiab/wrecker) — seeded inactive, admin-activated. No T&T rate
   card exists for hiab/wrecker (phone-quote market, confirmed by
   search); rates anchored to a real 2026 T&T marketplace listing and
   international hourly comparables, not invented numbers.

Full detail, exact commit hashes, and the live-verification transcripts
for every item above: `git log` on this branch, each commit message is
written as a standalone incident report.

---

## GENUINE REMAINING GAPS (verified 2026-07-16)

1. STRIPE KEYS NOT SET — blocks all card payments (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET).
2. WIPAY KEYS NOT SET — WiPay card payments return `coming_soon`.
3. NO KIOSK NODE HAS A PHYSICAL TAG PROVISIONED — `kiosk_nodes.tag_uid` is
   NULL on every live row. The NFC-tap verification path (settlement v3)
   is correct code but unusable until nodes are physically provisioned;
   geofence-based verification works today.
4. NO MERCHANT HAS AN OWNER ACCOUNT LINKED — `merchants.created_by` is
   NULL on every live row. Hotel/merchant notifications correctly no-op
   rather than crash, but nobody currently receives them.
5. MOBILE APPS NEVER BUILT FOR DISTRIBUTION — EAS config is in place.
   Run: `cd apps/rider && eas build --profile preview --platform android`
   (same pattern for driver, merchant-mobile).
6. THREE SCOPED-NOT-BUILT FEATURES (design written, code not started):
   driver-facing AI demand heatmap; G-Escape airline-lane demand
   aggregation (make a closed route a no-brainer for an airline to
   reopen); G's conversational "active" mode (plain-English chat with
   live econ context, reasoning through the same analytical lenses used
   in ad-hoc audits, always landing in the g_proposed_actions inbox —
   never auto-executing).

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

   This also applies to node/kiosk attribution for commission — see
   `verify_kiosk_origin()` for the pattern (real tap or geofence, never
   a bare client-supplied id).

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

10. `wallet_transactions` truth is `SUM(amount)`, not the `wallets.balance_cents`
    cache — most money-moving paths never update that cache (confirmed:
    `credit_merchant_commission` never touches it). Any new balance check
    must read `wallet_transactions` directly, matching `get_wallet_balance()`.

11. Before writing a new INSERT into `wallet_transactions`, check the
    live `wallet_transactions_transaction_type_check` constraint and the
    real column list (`id, user_id, ride_id, amount, currency,
    transaction_type, description, reference_id, status, created_at` —
    no `metadata`, no `amount_cents`). This exact class of bug caused
    the majority of the 2026-07-16 session's crash fixes.

12. Before touching any G-Escape booking code, confirm which of the two
    systems you're in: `flight_blocks`/`package_reservations` (current,
    live, what riders book through) vs `escape_group_participants`
    (older, still-live, but disconnected — only the stale admin UI uses
    it). Do not assume a fix to one applies to the other.

---

## RIDE STATE MACHINE

Correct flow:
  searching → assigned → arrived → in_progress → completed → payment_confirmed → closed

Current enforcement:
  - complete_ride blocks non-in_progress
  - State transitions enforced via .in('status', validStates) in edge functions
  - Client must never set ride status directly — always call an edge function

Payment state flow on rides.payment_status:
  pending → authorized → captured → confirmed → receipt_sent

Settlement (all three payment methods — cash, wallet, card — as of
2026-07-16 share ONE function, `compute_ride_split`, for the actual
split math): driver pool 80% (78% if the driver's territory has an
active commander), reserve 1.5%, node rent 2% of the platform's take
when the kiosk origin is verified, platform keeps the remainder.

---

## RLS RULES

profiles table — correct policy:
  - User can read and write their OWN profile only
  - Driver can read profile of their CURRENTLY ASSIGNED rider only
    (rides.driver_id = auth.uid() AND rides.status IN ('assigned','arrived','in_progress'))
  - Rider can read profile of their CURRENTLY ASSIGNED driver only
    (rides.rider_id = auth.uid() AND rides.status IN ('assigned','arrived','in_progress'))
  - No other cross-user profile reads permitted
  - NOTE: drivers themselves never get a profiles row at all in this
    system — profiles is rider/admin/merchant/pod_commander only. Do not
    assume a driver has a profiles row anywhere you write new code.

ride_events table — append only:
  - No UPDATE policy
  - No DELETE policy
  - SELECT: own rides only (riders/drivers), all rides (admin role through edge functions)

payment_ledger table — read only for users:
  - SELECT: own records only
  - INSERT: edge functions via service role only
  - No UPDATE, no DELETE

g_proposed_actions table — G's approval inbox, the reusable pattern for
"AI/system proposes, admin has final control":
  - Anything filed here (department, action_type, title, reasoning,
    category, amount_cents, payload) is pending until admin calls
    `g_decide_action(id, 'approved'|'rejected')`.
  - Approval triggers `g_execute_action` (edge function), which looks up
    a reviewed-code handler by `action_type` in its `HANDLERS` registry —
    there is no LLM in the execution path. Adding a new proposable
    action means adding a real handler here, not just filing the row.
  - `apps/admin/src/pages/Approvals.tsx` renders ANY pending row
    generically — no action_type whitelist — so new proposal types need
    no UI work, only a handler.

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

### Supabase Edge Function Secrets (see the sourced-from-code section above
### for the complete, accurate list — this env-file section only covers
### the client apps' public-safe values)

---

## TECH STACK

### Mobile Apps (rider, driver, merchant-mobile, admin-mobile)
  Framework:      Expo SDK 52, React Native, TypeScript
  Navigation:     React Navigation
  State:          React Context (RideContext, AuthContext, DriverContext)
  Maps:           react-native-maps + Mapbox
  Location:       expo-location
  Storage:        expo-secure-store (Auth sessions) — packages/core/src/client.ts:17
  Push:           expo-notifications + _shared/push.ts (FCM HTTP v1 + Expo fallback)
  Payments:       @stripe/stripe-react-native — SDK wired, Stripe keys not yet configured server-side

### Admin Dashboard (web) + Admin Mobile
  Web framework:  Vite + React + TypeScript
  Auth:           AdminSecurityGate (App.tsx) — checks session + admin role via edge function
  Approvals:      apps/admin/src/pages/Approvals.tsx — generic renderer for g_proposed_actions
  Status:         Web has broad page coverage; admin-mobile has a smaller subset of screens —
                  not yet at parity (see "Admin-mobile parity" as an open task if resuming this work)

### Edge Functions
  Runtime:        Deno
  Functions:      130+ — rides, grocery/merchant delivery, G-Escape (travel/, secure_escape_booking,
                  escape_sweep_tipping_points), G chief-of-staff (g_agent_runner, g_execute_action,
                  g_briefing), commander/node provisioning, NFC (nfc_event_handler is the single
                  source of NFC routing truth), settlement (compute_ride_split is the single
                  source of truth for the ride split as of 2026-07-16)
  Shared:         supabase/functions/_shared/ — auth.ts, rateLimit.ts, push.ts, sentry.ts, redis.ts,
                  llm.ts (AI gateway, Groq default), sms.ts (WhatsApp), networkUtility.ts (fetch
                  timeout wrapper), warm-brain.ts (optional Redis-backed cache)

### Database
  Provider:       Supabase Postgres + PostGIS
  Extensions:     PostGIS, pg_cron enabled
  RLS:            Enabled on all tables
  Migrations:     supabase/migrations/ — 130+. NOTE: local migration filenames use
                  session-chosen descriptive timestamps and consolidate several individual
                  production hotfixes into fewer files — they do NOT map 1:1 to the remote
                  migration version history (which timestamps each real `apply_migration`
                  call). Content parity was verified 2026-07-16 (every function's live body
                  diffed against its corresponding local file); filename/version parity was not
                  reconciled — treat `git log` + live `pg_get_functiondef` as ground truth for
                  "what actually changed when," not migration filenames.

---

## EXTERNAL SERVICE LINKS

  Stripe dashboard:       https://dashboard.stripe.com/register
  Stripe API keys:        https://dashboard.stripe.com/apikeys
  Stripe webhooks:        https://dashboard.stripe.com/webhooks
  WiPay dashboard:        https://dashboard.wipayfinancial.com
  Firebase console:       https://console.firebase.google.com
  Mapbox signup:          https://account.mapbox.com/auth/signup/
  Groq console:           https://console.groq.com
  Amadeus for developers: https://developers.amadeus.com/register
  Booking.com partner:    https://www.booking.com/affiliate-program/v2/index.html
  Sentry signup:          https://sentry.io/signup/
  Supabase dashboard:     https://supabase.com/dashboard/project/ffbbuafgeypvkpcuvdnv

---

## SESSION RULES

- Read the actual file before changing it — never assume its contents
- Only touch files within the scope of the current task
- Output complete files only — no partial snippets
- Before applying any migration that touches a money-moving function,
  dry-run it in a rolled-back transaction against real (or realistic
  synthetic) data first — this is how the 2026-07-16 session's 8+ crash
  bugs were caught before they could hit a real payment
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

---

## COMMUNICATION STYLE

Explain status in plain language first: what changed, what the user should
see, and what to do next. Keep file paths, SQL, and stack traces in a
"Technical details" section at the end. Never lead with jargon.

If a status update is longer than a screen, it is too long. The user has
asked for plain-language status more than once — treat that as standing.

## VERIFICATION RULES

A UI change is NOT verified until it is confirmed in the USER'S environment.
After any frontend edit:
  1. Confirm the dev server is running the same branch/worktree the user has
     open — check `git branch` and the running server's path, not assumption.
  2. State the exact URL and give a hard-refresh instruction.
  3. Ask the user to confirm what they see BEFORE claiming success.

Screenshots from the sandboxed browser are NOT sufficient evidence. It lacks
WebGL and may serve cached or wrong-branch content. Two sessions ended with
the user staring at an unchanged layout while success was being reported.

If a styling change produces a byte-identical render, treat that as a FAILURE
and investigate caching, the wrong worktree, or a component that never mounted
— do not report it as done.

Backend work has the same rule in a different form: prove it against the live
database, not against source reading.

## DATABASE & MIGRATION RULES

Before writing any migration or RPC, read the CURRENT definition from the live
database (`information_schema`, `pg_proc`, `pg_constraint`) to confirm columns,
enum values, and function signatures actually exist. Most serious bugs here
lived in the gap between "TypeScript compiles" and "the database accepts it".

  - Dry-run every money-path migration in a rolled-back transaction against
    real data BEFORE applying, then smoke-test with real ids after.
  - `CREATE OR REPLACE FUNCTION` cannot add a trailing parameter — it creates
    a NEW overload. `DROP FUNCTION` the old signature first, then re-`GRANT`,
    because DROP wipes grants.
  - After adding an overload, confirm every CALLER's argument set still
    resolves. A call with named args matching no overload fails at runtime
    while typechecking clean.
  - Postgres `format()` does not support printf-style specifiers like `%d`.
    Use `%s`.
  - RLS policies alone guarantee nothing — the role also needs the table
    GRANT. Check `pg_policies` AND `role_table_grants` together.
  - NEVER run `supabase db push`. The live DB and the migration files have
    diverged (far more applied than tracked, numbering does not line up).
    Apply migrations individually and verify each.
  - Anything applied straight to production must also be captured in a
    migration file, or a rebuild silently loses it.

## SECRETS & DEPLOYS

Never inline a literal secret into SQL or a function body — it leaks into any
`pg_get_functiondef` dump. Read secrets from Supabase Vault via
`public.platform_cron_secret()` or an edge-function env var.

Deploy edge functions in small batches (3-5 max). A bulk deploy has been
blocked before. Preserve each function's existing `verify_jwt` setting — read
it from the Management API first. Webhooks (`stripe_webhook`, `wipay_webhook`)
and cron-secret callers MUST stay `verify_jwt=false` or the caller is rejected
at the gateway before reaching our code.

## CRON & SCHEDULED JOBS

After creating or modifying any cron job, immediately query
`cron.job_run_details` for failures and confirm the first scheduled fire time
is correct. A prematurely-firing safety sweep once created 101 bogus alerts
that had to be cleaned up by hand.

Any new sweep that acts on historical rows needs a launch cutoff set BEFORE
the job exists, not after.
