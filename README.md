# G-Taxi 868

A multi-service platform for Trinidad & Tobago, built around ride-hailing.
One rider account also reaches grocery delivery, laundry, merchant delivery,
group travel packages, and a bar-membership product — with a network of
commander-recruited merchant nodes underneath, and an AI assistant ("G") that
proposes actions for an admin to approve.

**Status: pre-launch. Not yet taking real money.** See
[Honest status](#honest-status) — that section is the most important part of
this file, and it is kept truthful on purpose.

---

## Start here

If you only read one thing:

- The **money maths is sound and tested.** 400+ random fares per run, no cent
  unaccounted for.
- **Card payments do not work end to end.** Cash and wallet do.
- **Nothing has ever been paid for real.** 128 rides exist; `0` have ever been
  paid. Everything below was verified by simulation against the real database,
  not by real customers.

---

## What's in here

```
apps/
  rider/            Rider phone app          (Expo / React Native)
  driver/           Driver phone app         (Expo / React Native)
  merchant/         Merchant web dashboard   (Vite / React)
  merchant-mobile/  Merchant phone app       (Expo / React Native)
  admin/            Admin web dashboard      (Vite / React)
  admin-mobile/     Admin phone app          (Expo — partial, ~1/3 of web)
  qr-landing/       Static QR landing page

packages/
  core/                  Shared Supabase client + env
  shared/                Shared types/helpers
  design-system/         Shared UI tokens (web)
  design-system-native/  Shared UI tokens (native)

supabase/
  functions/    124 Deno edge functions — all server logic lives here
  migrations/   49 SQL migrations
  tests/        Money-path regression harness  <-- run this before shipping
```

## Running it

```bash
npm install

npm run dev:rider      # rider app
npm run dev:driver     # driver app
npm run dev:admin      # admin dashboard
npm run dev:merchant   # merchant dashboard
```

Each app needs its own `.env` (see `apps/<app>/.env`). Missing Supabase env
vars will crash the app at startup — that's deliberate, so a
misconfigured build fails loudly instead of silently talking to nothing.

## Checking the money is safe

```bash
DATABASE_URL="<session-mode connection string>" supabase/tests/run.sh
```

Runs ~27 assertions against the real database inside a single transaction that
**ends in `ROLLBACK`** — it writes nothing permanent. Every line must say
`PASS`. If it prints `DO NOT SHIP`, don't.

It checks: the fare split accounts for every cent, a retried payment never
charges twice, a replayed payment webhook credits only once, insufficient funds
is refused honestly, and money functions can't be called from a phone.

Why it exists: every serious bug found in this codebase lived in the gap
between *"the TypeScript compiles"* and *"the database actually accepts it"* —
a wrong enum value, a missing permission, a function signature no caller
matched. A typechecker cannot see any of those. This harness can.

---

## Honest status

### Works, and is tested

- **Ride flow** — request → match → accept → in progress → complete.
- **Cash rides** — driver confirms collection; debt and splits recorded.
- **Wallet rides** — balance checked, rider debited, driver credited.
- **Fare splits** — driver 80% (78% where a territory has an active commander),
  platform 15%, reserve 1.5%. Verified across hundreds of random fares with no
  rounding leak.
- **Two drivers cannot take the same ride** — enforced by an atomic lock.
- **A payment cannot be taken twice** — enforced by a database constraint, not
  by hopeful code.
- **Grocery / merchant delivery, laundry, G-Escape travel, G Spot venues,
  G Garage** — all have working screens and server logic.

### Does not work yet

| What | Why |
|---|---|
| **Card payments** | Blocked on purpose in the rider app pending WiPay. Nothing routes to the payment screen. |
| **WiPay card settlement** | A WiPay payment marks the ride paid but **never credits the driver**. Must be fixed before card is switched on. |
| **Push to admin phones** | No admin has registered a device token. Alerts still land in the database and the dashboard. |
| **G-Escape flights / lodging** | Needs Amadeus + Booking API keys. |
| **WhatsApp messages** | Falls back to link generation without credentials. |
| **NFC tap payments** | Code exists, never tested in production. |

### Not a code problem

- No payment provider keys are live.
- 10 of 14 drivers are approved/online, but most are test accounts.
- One distinct rider has ever taken a ride.
- Driver for-hire (`'H'`) plate status isn't tracked anywhere. In T&T, carrying
  passengers for reward on a private plate is illegal and voids insurance. This
  is a legal question, not a bug, and it should be settled before real riders.

---

## Rules that will save you

**1. Never run `supabase db push`.**
The database reports 107 applied migrations; this repo has 49 files, and the
numbering doesn't line up. `db push` would treat already-applied migrations as
pending and re-run them. Apply migrations one at a time and verify each.

**2. Never call `.catch()` on a Supabase query.**

```ts
// WRONG — throws every time. A query is not a real Promise.
const { data } = await supabase.from('x').select().catch(() => ({ data: null }))

// RIGHT
const { data } = await supabase.from('x').select().then(r => r, () => ({ data: null }))
```

This one bug was live in 75 places across 23 files, including driver cash
withdrawal and both payment webhooks.

**3. Never trust an ID sent from a phone.**
Server code must resolve who is calling from their login token, then look
everything else up from that. Passing a `user_id` in the request body and
trusting it is how someone charges another person's wallet.

**4. Don't drop `unique_wallet_transaction_per_ride`.**
That single database constraint is what makes charging a rider twice
impossible. The constraint carries a comment saying so.

**5. Service keys never go in an app.**
`SUPABASE_SERVICE_ROLE_KEY` belongs only in Supabase's own secret storage.
Anything in `apps/` ships to a phone and can be read.

---

## Documentation map

| File | What it's for |
|---|---|
| `README.md` | This file — start here |
| `CLAUDE.md` / `AGENTS.md` | Detailed working context for AI coding agents |
| `PRODUCT.md` | Product intent |
| `MISSION.md` | Why the project exists |
| `COMPLIANCE_CHECKLIST.md` | Regulatory checklist |
| `RESOURCES.md` | External services and links |
| `NOTES.md` / `Jarvis_System_Map.md` | Older working notes — **treat as historical** |

**A warning about the older docs:** several have contained claims that turned
out to be untrue when checked against the live database — wrong fare-split
percentages, features described as missing that already existed, and features
described as working that had never run. Trust this order: **the live database
first, then the code, then `git log`, then the docs.**

## Branches

`main` is current and contains everything. Other `claude/*` branches are
finished work already merged in, or stale experiments — they are **not** ahead
of `main` on anything except one unfinished WiPay Tap-to-Pay feature, which was
deliberately left out because it would pay passengers' money in without paying
drivers out.

If in doubt, branch from `main`.
