# Spec: WhatsApp listener + Fleetbase dispatch integration

- **Status:** DRAFT — design only. Taylor's explicit approval required before any build work starts.
- **Date:** 2026-09-29. **Author:** 40 (Muse), at Taylor's direction.
- **Branch:** `spec/fleetbase-whatsapp-ingress` (off `origin/main`, spec doc only — no code).

## 0. Objective

Automate the tap-to-ride fallback so a WhatsApp booking triggers dispatch the same
way an in-app booking does, with Fleetbase Fleet-Ops as the **single dispatcher
console** and Supabase as the **single source of truth**. Two ingress channels
(rider app, WhatsApp), one ride lifecycle, one dispatch view.

This spec is the design Taylor approves. The build prompt for the implementing
agent is Section 10.

## 1. Verified starting position (checked 29 Sep 2026)

- `origin/main` contains **none** of the WhatsApp work. The following exist only
  as **uncommitted working-tree changes** in the VM clone (stashed 29 Sep 2026 as
  `WIP: whatsapp ingress scaffold` — reconcile before build, do not silently
  absorb):
  - `supabase/functions/whatsapp_webhook/index.ts` — Meta verification handshake,
    HMAC-SHA256 check on inbound POSTs, parses text / location / image / button /
    interactive replies, delegates to `_shared/whatsapp_flow.ts`; unsigned internal
    `POST /events/ride-assigned` and `/events/ride-completed`.
  - `supabase/functions/_shared/whatsapp_flow.ts` — conversation state machine.
  - `supabase/migrations/20260925130000_whatsapp_tap_flow.sql` — `whatsapp_conversations`
    (states TAP_RECEIVED → AWAITING_DESTINATION → FARE_QUOTED → AWAITING_SELFIE →
    DRIVER_SEARCHING → DRIVER_ASSIGNED → COMPLETED / APP_INVITE_SENT / CANCELLED /
    NO_DRIVERS), `whatsapp_processed_messages` (Meta message-id PK = idempotency),
    `rides.origin` (`'app'` default, `'whatsapp'`), `ride-selfies` bucket,
    `notify_whatsapp_ride_event` trigger → pg_net POST to the webhook `/events/*`.
  - `apps/qr-landing/tap.html` — pre-filled WhatsApp message `GTAXI TAP <node_id>`.
- **Defect in the scaffold:** `whatsapp_webhook/index.ts` lines 27–28 contain literal
  `<redacted>` placeholders (`const VERIFY_TOKEN=<redacted>`) — syntactically broken.
  Replace with `Deno.env.get("VERIFY_TOKEN")` / `Deno.env.get("WHATSAPP_APP_SECRET")`.
  Secrets live in the Supabase secret store, never in the repo, never in chat.
  Note: `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` placeholders are already
  in the edge-function secret store (house decision 2026-06-25: Meta WhatsApp Cloud
  API replaced Twilio) — Taylor fills the real values himself.
- `public.rides`: `status` is the `ride_status` enum
  (`requested, searching, assigned, arrived, in_progress, completed, cancelled,
  scheduled, blocked, expired, waiting_queue, payment_confirmed`);
  an `idempotency_key text` column **already exists** — use it.
  Canonical flow per repo AGENTS.md:
  `searching → assigned → arrived → in_progress → completed → payment_confirmed → closed`
  (`requested` = pre-search ingress state). `complete_ride` blocks non-`in_progress`;
  clients never set status directly — edge functions only.
- **Edge-function cap:** ~100 functions deployed, at the cap. A prior `whatsapp_webhook`
  was deleted 2026-06-20 to stay under it. The sync worker must fit the cap — extend
  an existing function or reclaim a deleted slot; do not assume a free slot.
- Absolute repo rules that bind this build: edge functions never trust client-supplied
  IDs (AGENTS.md rule 2 — the Meta webhook path uses HMAC verification instead of JWT;
  that exception is already documented in the scaffold); DB connections via transaction
  pooler port 6543, never 5432 (rule 3); output complete files only (rule 9).
- Approved-but-unbuilt Phase-2 scope this spec extends (not replaces): WhatsApp
  ingress persist-first, idempotent, retry/backoff, dead-letter list, and the
  `markProcessed` ordering fix (mark **after** successful handling, never before).
- Fleetbase (`fleetbase/fleetbase`, **AGPL-3.0**): modular logistics OS.
  `fleetops`/`fleetops-engine` = dispatch/order engine (the console target);
  REST API + webhooks + extension system; `navigator-app` = driver mobile;
  `laravel-twilio` exists in the org; **no WhatsApp extension exists**.
  Self-host or Fleetbase Cloud.

## 2. Hard boundaries (non-goals)

1. **No money math in Fleetbase.** Fares, driver split (80% / 78% w/ active G-Lead),
   2% commander override, 1.5% capital reserve, payouts — all stay in G-Taxi/Supabase.
   Fleetbase is ops, not economics.
2. **Drivers keep ONE app:** the G-Taxi driver app. No Fleetbase `navigator-app`
   for pilot drivers. Assignment reaches drivers via the existing Expo push.
3. **No production deploy** without Taylor's explicit, separate go-ahead (standing
   rule). Preview/staging only, test data clearly identifiable.
4. **Do not touch the legacy dispatch-queue rows** (RIDE dispatched since 18 Sep;
   DELIVERY failed with no recorded error) until the report on them is delivered.
5. **Fleetbase's own source stays outside the G-Taxi repo — external service only,
   never forked, copied, or merged in.** Fleetbase is AGPL-3.0. That license has a
   network-use clause: if Fleetbase's code is built into a product and that product
   is served to users over a network — which G-Taxi is, every day — the combined
   work's source can be required to be made public. Folding Fleetbase's code into
   this monorepo risks exposing G-Taxi's own proprietary logic (settlement, splits,
   dispatch scoring) to that same obligation. The integration in this spec avoids
   that entirely: G-Taxi talks to an unmodified, separately-hosted Fleetbase over
   its REST API and webhooks (Section 6), the same way it talks to Stripe or
   Mapbox. No Fleetbase source file is ever copied into `apps/` or `packages/`.
   If a future need requires modifying Fleetbase's own behavior, that change is
   made and run as a fork of Fleetbase itself, on its own hosting, kept fully
   separate from this repo — not merged in. This rule does not expire with the
   pilot; it applies to any future Fleetbase work, self-hosted or not.
5. **No unofficial WhatsApp clients** (Baileys-style phone-linked libraries = ban risk
   on the pilot number). Meta Cloud API or Twilio WhatsApp only — provider is
   Taylor's decision (Section 11).
6. Pre-launch honesty: nothing here is advertised or promised as live until it passes
   the digital tests in Section 10 on preview.

## 3. Architecture

```
Rider app ──create_ride──▶ SUPABASE (source of truth) ◀──webhook── Fleetbase
                              │  rides, whatsapp_*               │  Fleet-Ops
NFC/QR tap ──WhatsApp──▶ whatsapp_webhook (listener) ──parse──▶ │  console
prefill msg      ▲                │ persist-first, idempotent    │  (dispatch
                 │                ▼                              │   view only)
                 └──rider notifications (PIN/plate/tracking)─────┘
Driver app ◀──Expo push── assignment ◀── dispatcher assigns in Fleet-Ops console
```

Ownership: Supabase owns **state + money**; Fleetbase owns the **dispatch view**;
WhatsApp is the **channel**. Each system does what it is good at; writes are
minimal and one-directional per hop ("write-balancing").

## 4. Channel flows

### 4a. In-app flow (existing — add console mirroring only)
1. Rider app → `create_ride` → `rides` row (`origin='app'`,
   `idempotency_key='app:<client_uuid>'`, status `requested`→`searching`).
2. Sync worker creates the Fleet-Ops order (Section 6).
3. Dispatcher assigns in the Fleet-Ops console (or auto-assign nearest) →
   assignment pushed to the **G-Taxi driver app** via existing Expo push.
4. Driver accepts in driver app → `rides.status='assigned'` → mirrors to Fleetbase.
5. `arrived` → `in_progress` → `completed`; fare/split/settle happen in Supabase only.

### 4b. WhatsApp tap flow
1. Rider taps NFC puck / scans QR → `tap.html` → WhatsApp prefill `GTAXI TAP <node_id>`.
2. Provider webhook → `whatsapp_webhook`: verify HMAC → **persist first** into
   `whatsapp_processed_messages` (Meta message-id dedupe; redeliveries are no-ops).
3. Parse → `whatsapp_conversations` row (`TAP_RECEIVED`, `node_id` = tag/kiosk,
   phone normalized). Double-tap from the same number attaches to the existing
   active conversation/ride — never a duplicate.
4. Conversation: destination → fare quote (via `estimate_fare`) → selfie → dispatch.
5. Ride created: `origin='whatsapp'`, `idempotency_key='wa:<meta_message_id>'`,
   tag/node id in `metadata`.
6. Sync worker → Fleet-Ops order → dispatcher assigns → `/events/ride-assigned`
   → rider WhatsApp: ride PIN + plate + driver name + live tracking link.
7. Driver completes in driver app → `/events/ride-completed` → rider WhatsApp:
   receipt + app invite.

### 4c. Tag attribution
`node_id`/tag UID is carried on `whatsapp_conversations.node_id` and `rides.metadata`
so every WhatsApp ride is attributable to the NFC point it came from (the pilot
readiness bar: walk in, mark a blank tag, hand over a working app).

## 5. The single ride state machine

- `public.rides.status` (`ride_status` enum) is the **only** state machine. Canonical
  flow (repo AGENTS.md — do not alter without reading that section first):
  `searching → assigned → arrived → in_progress → completed → payment_confirmed → closed`,
  with `requested` as the pre-search ingress state for both channels.
- Forward-only: `cancelled` from any pre-completed state; `blocked`/`expired` are
  terminal exceptions. No backward transitions, ever.
- The Fleetbase order status is a **mirror**, never a driver of transitions.
  Console actions (assign/cancel) write through the sync worker to Supabase first,
  then mirror to Fleetbase.
- Both channels write `rides` rows; channel in `rides.origin`; tag in `metadata`.

## 6. Sync contract (the cherry-pick — this and only this crosses the boundary)

Supabase → Fleetbase (REST API, ride UUID as the external/dedupe key):
- Order create: ride UUID, pickup/dropoff lat-lng + addresses, rider phone (comms
  only), `origin`, tag/node id, `created_at`.
- Order updates: status transitions, `driver_id` assignment, ETA.

Fleetbase → Supabase (webhooks): status changes initiated in the console, driver
assignment, completion notes.

**Never crosses:** fares, splits, payouts, wallet, or personal data beyond what
dispatch needs.

Reliability: retry with backoff; dead-letter list for permanent failures (Phase-2
pattern). `markProcessed` ordering: mark **after** the mirror succeeds, not before.
Unsigned `/events/*` calls re-read the ride from the DB and act only on genuine
state (keep the webhook's existing guard — forged calls change nothing).

## 7. Notifications

- **Driver:** Expo push via existing infra, deep link into the driver-app job screen.
- **Rider (WhatsApp):** assignment (PIN, plate, driver name, tracking link),
  arrival, completion receipt + app invite — sent via the same provider as ingress.

## 8. Hosting & secrets

- Fleetbase: self-host (server cost — Taylor's call) or Fleetbase Cloud.
- WhatsApp provider: **Meta WhatsApp Cloud API** — house decision 2026-06-25
  (Twilio removed; `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` placeholders
  already in the edge-function secret store). When keys are absent the system falls
  back to `wa.me` deep links. Taylor provides the real key values himself.
- All secrets (`VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, Fleetbase API keys) go to
  secret stores. Claude Code hard-refuses to type secret values — Taylor runs the
  set commands in his own terminal.
- AGPL-3.0: see the hard boundary in Section 2, item 5. Fleetbase's own code is
  never merged into this repo — it runs as its own separate, unmodified service
  that G-Taxi talks to over its API. If Fleetbase's own behavior ever needs to
  change, that happens as a fork of Fleetbase itself, hosted separately, not as
  changes inside this repo.

## 9. Load balancing (what it actually means at pilot scale)

There is no server-load problem at 2–3 drivers. "Load balance" here = two things:
1. **Write-balancing:** each system owns its lane (Section 3); minimal double-writes,
   one direction per hop. Neither Supabase nor Fleetbase is ever asked to be the
   other.
2. **Dispatch fairness:** nearest-driver / round-robin assignment across drivers,
   which Fleet-Ops provides natively.

## 10. Build prompt — ready-then-tested gates

> This section is the instruction set for the implementing agent (Claude Code).
> It is not a suggestion list. A step is not "done" when the code exists — it is
> done when the test in this section passes on preview.

**Branch discipline.** Feature branch off `origin/main`. Verify every read against
`origin/main` — never trust the stale `claude/g-chief-of-staff` branch checked out
in the desktop working directory (standing lesson: it has produced false
"doesn't exist" findings). PR for review; no direct pushes to `main`. Commits,
pushes, and deploys each need Taylor's separate approval — never bundled.

**Environment.** Preview/staging only. Both preview and production currently point
at Supabase project `ffbbuafgeypvkpcuvdnv` (Taylor-approved 28 Sep 2026) — test
data must be clearly identifiable. Production deploy of anything = Taylor's
explicit go-ahead, one action at a time.

**Fix first:** the `<redacted>` secret placeholders in `whatsapp_webhook/index.ts`
(Section 1) → `Deno.env.get(...)`; reconcile the stashed WIP scaffold before
building on it.

**Digital test scenarios (all must pass on preview before the pilot touches this):**
1. WhatsApp tap end-to-end: prefill → conversation → fare quote → ride row
   (`origin='whatsapp'`, tag recorded) → Fleet-Ops order appears → assign in
   console → driver-app push → accept → PIN/plate/tracking to rider WhatsApp →
   complete → receipt.
2. In-app ride end-to-end with console mirroring (`origin='app'`).
3. Idempotency: redelivered Meta webhook → zero duplicate rides, zero duplicate
   Fleet-Ops orders.
4. Dead-letter: kill the Fleetbase endpoint mid-flow → ride still created in
   Supabase; retry recovers; permanent failures land on the dead-letter list.
5. Double-tap: two taps from the same number → exactly one ride.
6. Forgery: unsigned/spoofed `/events/*` call → nothing changes (re-read guard).
7. Money isolation: complete a ride → assert no fare/payout/wallet field was sent
   to or stored in Fleetbase.

**Acceptance:** all seven scenarios green on preview **plus** Taylor's own
walkthrough. Then, and only then, does the production conversation happen.

## 11. Open decisions (Taylor's call)

1. Fleetbase hosting: **self-host** vs **Fleetbase Cloud**.
2. Real values for `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN`
   (Meta app + business verification — Taylor's hands).
3. Pilot sequencing: pilot waits for this chain, or runs manual-first while this
   builds in parallel? (Recommendation: manual-first — this chain must not block
   the pilot.)
4. Reconcile/merge the stashed WhatsApp WIP scaffold before build starts.

## 12. Out of scope

Promo codes, fatigue toggle, kickback wording, virtual dispatch, AI concierge
depth, behavioral hooks — roadmap items per the 29 Sep methodology correction.
Untouched by this spec.
