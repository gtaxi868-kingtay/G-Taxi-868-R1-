# PHASE 1 — G-TAXI ECOSYSTEM MAP & BACKEND ARCHITECTURE

## Table of Contents
1. [The Unified System Philosophy](#1-the-unified-system-philosophy)
2. [Backend & Routing Blueprint](#2-backend--routing-blueprint)
3. [App 1: The Rider App (Lazy Luxury)](#3-app-1-the-rider-app-lazy-luxury)
4. [App 2: The Driver App (Tactical HUD)](#4-app-2-the-driver-app-tactical-hud)
5. [App 3: The Merchant App (Enterprise Portal)](#5-app-3-the-merchant-app-enterprise-portal)
6. [App 4: The Admin/Overwatch App (God Mode)](#6-app-4-the-adminoverwatch-app-god-mode)
7. [Cross-App Integration Matrix](#7-cross-app-integration-matrix)
8. [State Flow Orchestration](#8-state-flow-orchestration)
9. [Pending Implementation Backlog](#9-pending-implementation-backlog)

---

## 1. The Unified System Philosophy

G-TAXI is not four independent apps. It is **one system with four surfaces**. Every state mutation in any app must be instantly truthy across all others. The system operates on three principles:

**Principle A — Single Source of Truth (Supabase)**
All canonical state lives in Postgres. Redis caches ephemeral data (driver GPS). Stripe owns payment intents. But the ride record, the order, the wallet balance — those are database rows. No app caches write-authority for anything that another app needs to see.

**Principle B — Event-Driven State Diffusion**
No polling. When a rider creates a ride, the flow is:
```
rider app → POST create_ride → DB insert + Realtime broadcast → 
  match_driver (edge fn) → DB update + Realtime broadcast →
    driver app receives via Realtime subscription → UI updates
```
Every status change writes to `ride_events`. Every Realtime subscription listens on the channel `ride:{ride_id}` and `user:{user_id}`. The frontend never polls — it Reacts.

**Principle C — Optimistic UI with Background Reconciliation**
The UI renders immediately with the expected next state. If the edge function rejects the transition (e.g., state machine violation), the UI rolls back within <200ms. The Outbox Service in `@gtaxi/shared/OutboxService` queues mutations when offline and replays them in order when connectivity returns.

---

## 2. Backend & Routing Blueprint

### 2.1 Infrastructure Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE PLATFORM                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Postgres │  │   Auth   │  │ Realtime │  │ Edge Functions│  │
│  │(27 migs) │  │(JWT/SAML)│  │ (WS/sub) │  │  (70 deno fns)│  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│         │             │             │               │          │
│         ▼             ▼             ▼               ▼          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  RLS POLICIES — Row-level security on every table       │   │
│  │  + CHECK constraints on ride_status transitions          │   │
│  │  + Wallet deduction via SELECT FOR UPDATE               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│   REDIS      │    │     STRIPE      │    │    MAPBOX    │
│ (Upstash)    │    │  (Payments)     │    │  (Maps/Geo)  │
│ GPS cache    │    │  PI/customers   │    │  directions  │
│ rate limits  │    │  webhooks→fn    │    │  geocoding   │
└──────────────┘    └─────────────────┘    └──────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                FIREBASE FCM (Push Notifications)             │
│  driver_app ← NEW_RIDE_OFFER, rider_app ← DRIVER_ASSIGNED   │
│  merchant_app ← NEW_ORDER, admin_app ← ALERT               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Shared Packages (The Connective Tissue)

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@gtaxi/core` | Supabase client, env resolution, shared utilities | `supabase` client, `ENV`, `installCrashReporter` |
| `@gtaxi/shared` | Cross-app business logic relay | `ENV`, `OutboxService` |
| `@gtaxi/shared-web` | Web-specific shared logic | Admin utilities |
| `@gtaxi/design-system` | Universal design tokens | `SURFACE`, `VOICES` color/type tokens |
| `@gtaxi/design-system-native` | RN component library | Shared buttons, inputs, modals |
| `@gtaxi/design-system-web` | Web component library | Admin UI components |
| `@gtaxi/config` | Zod schema validation | Env var schemas |
| `@gtaxi/bootstrap` | App initialization | Startup sequences |
| `@gtaxi/api` | API client layer | Edge function wrappers |

### 2.3 Routing Strategy — Zero Loading Screens

Each app uses **React Navigation** with a **preloaded navigation tree**. The loading screen is never shown after first launch because:

**Launch sequence (invisible to user):**
1. `SplashScreen.preventAutoHideAsync()` holds the native splash
2. `supabase.auth.getSession()` resolves immediately (session cached in SecureStore)
3. Session user → fetch profile → resolve role → determine root stack
4. Prefetch the rider's/driver's active ride (if any) in parallel
5. Realtime subscriptions are opened before the first screen renders
6. `SplashScreen.hideAsync()` — user sees the correct screen immediately

**No blank loading states during navigation:**
- All screens are registered in the navigator upfront (no `React.lazy` on critical paths)
- Tab screens are mounted on initial render (no lazy tabs)
- The only `React.lazy` boundaries are for secondary verticals (grocery, laundry) that are not on the main navigation spine

### 2.4 Cross-App Communication Protocol

```
  RIDER APP              EDGE FUNCTIONS               DRIVER APP
     │                        │                          │
     │  POST create_ride      │                          │
     ├───────────────────────►│                          │
     │                        │  INSERT rides (searching) │
     │                        │  INSERT ride_events      │
     │                        │  Realtime broadcast      │
     │  ◄─── 200 OK ─────────┤     ride:{id}            │
     │                        │     user:{driver_ids}    │
     │                        │          │               │
     │  ◄─── Realtime ────────┤◄─────────┘               │
     │  ride:{id} status=     │                          │
     │  searching             │                          │
     │                        │                          │
     │                        │  match_driver runs       │
     │                        │     │                    │
     │                        │     ├──► SELECT drivers  │
     │                        │     │    near pickup     │
     │                        │     │    via Redis GEO   │
     │                        │     ├──► INSERT offer    │
     │                        │     ├──► Push notif     ├─► recv offer
     │                        │     │    to driver       │    │
     │                        │     │                    │  POST accept_ride
     │                        │     │                    ├───►
     │  ◄─── Realtime ────────┤◄────┘                    │
     │  ride:{id} status=     │                          │
     │  assigned, driver={}   │                          │
```

**Key channels:**
- `ride:{ride_id}` — Both rider and assigned driver subscribe here
- `user:{user_id}` — Personal notifications channel
- `driver:{driver_id}` — Driver's match offers
- `merchant:{merchant_id}` — New orders for merchant
- `admin:alerts` — Global admin alerts

### 2.5 Offline/Online State Machine

```
                    ┌──────────┐
          ┌────────►│  ONLINE  │◄────────┐
          │         └──────────┘         │
     ┌────┴────┐                    ┌────┴────┐
     │NETWORK  │                    │NETWORK  │
     │LOST     │                    │RESTORED │
     └────┬────┘                    └────┬────┘
          │         ┌──────────┐         │
          └────────►│  OFFLINE ├─────────┘
                    └──────────┘
                         │
                    ┌────▼────────┐
                    │ Outbox Queue│
                    │ stores msgs │
                    │ in AsyncStorage
                    └────┬────────┘
                         │
                    ┌────▼────────┐
                    │ Replay in   │
                    │ FIFO order  │
                    └─────────────┘
```

The `OutboxService` in `@gtaxi/shared/OutboxService` handles this. It:
- Intercepts every edge function call when offline
- Stores the request payload with a sequence number
- On reconnect, replays in sequence order
- Drops duplicates via idempotency keys (`idempotency_key` column in relevant tables)

---

## 3. App 1: The Rider App (Lazy Luxury)

### 3.1 Navigational Architecture

```
                    ┌─────────────────────────┐
                    │    ANIMATED SPLASH      │
                    │  (brand animation,      │
                    │   only on cold start)   │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │      AUTH GATE          │
                    │  ┌──────────────────┐   │
                    │  │ session exists?  │───│───► Main Stack
                    │  │ no session       │   │
                    │  └──────────────────┘   │
                    │  ┌──────────────────┐   │
                    │  │   LoginScreen    │   │
                    │  │   SignupScreen   │   │
                    │  │  ForgotPassword  │   │
                    │  └──────────────────┘   │
                    └─────────────────────────┘
```

### 3.2 Main Stack (The 3D Nexus Entry Hub)

The main navigator after auth is a **Tab Navigator** with the "Nexus" — a central hub screen that acts as the app's control center:

```
┌──────────────────────────────────────────────────────────────┐
│                    TAB NAVIGATOR                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  HOME    │  │  NEXUS   │  │  TRIPS   │  │  PROFILE │    │
│  │ (Map +   │  │ (Hub)    │  │ (History)│  │ (Avatar) │    │
│  │  Ride    │  │          │  │          │  │          │    │
│  │  Bar)    │  │          │  │          │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Nexus Hub Screen** — The "3D" entry point:
- **Radial menu** with shortcuts to each vertical: Ride, Grocery, Package, Laundry, Subscription
- **Live wallet balance** floating widget (pulls from Realtime wallet subscription)
- **G-Link status indicator** (NFC puck sync status)
- **AI Concierge** chat bubble (quick voice/text input — routes to `handle_voice` / `ai_concierge_proactive` edge functions)
- **Active ride/widget** if one exists (pinned to top, always visible)

### 3.3 Vertical-Specific Flows

#### 3.3.1 Ride-Hailing Flow

```
HomeScreen ──► DestinationSearch ──► RideConfirmation
    │                                     │
    │  Set pickup via map tap             │  Choose vehicle type
    │  or saved places                    │  See estimated fare
    │  or NFC puck tap                    │  Select payment method
    └──────────────────┬──────────────────┘
                       │
                  SearchingDriver
                  (animated car search,
                   ETA countdown)
                       │
                  DriverAssigned/DriverFound
                  (live driver ETA map)
                       │
                  ActiveRideScreen
                  (turn-by-turn, live ETA,
                   SOS button, detour alert,
                   arrive animation)
                       │
                  RatingScreen ◄── ReceiptScreen
                  (rate driver, tip)   (fare breakdown,
                       │               payment_ledger entry)
                       ▼
                  RideReviewScreen
                  (AI summary of trip,
                   report issue if needed)
```

**NFC G-Link integration:**
- `NfcScanScreen` / `NfcHandshakeScreen` — Tap phone to taxi stand puck to auto-set pickup location, instant ride request without typing
- `TagMarkerScreen` — Register new NFC pucks at partner locations

#### 3.3.2 Grocery Flow

```
GroceryStorefrontScreen
  (merchant list, search by category)
       │
  ProductListingScreen
  (per merchant, with search/filter)
       │
  ProductDetailScreen
  (photos, price, add to cart)
       │
  GroceryCartScreen
  (cart management, delivery window)
       │
  GroceryOrderStatusScreen
  (live: merchant_preparing → courier_assigned → in_transit → delivered)
```

**Backend wiring:** `merchant_gateway` → `match_order_delivery` → `update_order_price` → `vision_pickup` → `verify_handoff`

#### 3.3.3 Package Delivery Flow

Triggered from Nexus Hub → "Send Package"
```
Address entry (pickup + dropoff)
  → Package details (photo via VisionScannerScreen, dimensions)
  → Fare estimate
  → Rider drop-off at merchant/driver
  → Tracking via same status screen
```

#### 3.3.4 Laundry Flow

```
LaundryLandingScreen
  (service selection: wash/fold, dry clean, iron)
       │
  LaundryEstimatorScreen
  (item count, pickup time, price calculation)
       │
  LaundryOrderStatusScreen
  (picked up → cleaned → delivered)
```

#### 3.3.5 Subscription Flow

```
SubscriptionScreen
  (weekly/monthly ride pass, AI concierge tier)
  → Stripe recurring payment via create_payment_intent
  → Wallet credits
```

### 3.4 Wallet & Payment Hub

```
WalletScreen
  ├── Balance (live, Realtime subscription)
  ├── Top-Up → WalletTopUpScreen (Stripe payment intent)
  ├── Transaction History (paginated list)
  ├── Payment Methods → PaymentScreen (Stripe saved cards)
  └── Promotions → PromoScreen
```

**Payment method resolution order:**
1. Wallet balance (checked via `SELECT ... FOR UPDATE` in `process_wallet_payment`)
2. Stripe card (via `create_payment_intent` → `stripe_webhook` captures)
3. Cash (shadow ledger with commission deduction)

### 3.5 Live Support

```
HelpScreen
  ├── AI Chat (concierge_proactive + handle_voice)
  ├── Report Issue → ReportIssueScreen (ride-specific)
  ├── Live Chat → ChatScreen (real-time ride driver chat)
  └── Legal → LegalScreen
```

### 3.6 G-Link Sync Protocols (NFC)

| Screen | Action | Edge Function |
|--------|--------|---------------|
| `NfcScanScreen` | Scan puck at taxi stand | `nfc_event_handler` |
| `NfcHandshakeScreen` | Complete pickup verification | `nfc_restore_session` |
| `TagMarkerScreen` | Register new puck location | `nfc_event_handler` |

The NFC flow triggers a ride request pre-filled with the stand's saved location — zero typing required.

---

## 4. App 2: The Driver App (Tactical HUD)

### 4.1 Navigational Architecture

```
┌──────────────────────────────────────┐
│         AUTH GATE                    │
│  ┌────────────────────────────┐      │
│  │ LoginScreen                │      │
│  │ RegisterScreen (with KYC)  │      │
│  │   └── KYC Steps:           │      │
│  │       1. Personal Info     │      │
│  │       2. Vehicle Details   │      │
│  │       3. License Upload    │      │
│  │       4. Background Check  │      │
│  │       5. PendingApproval   │      │
│  └────────────────────────────┘      │
└──────────────────────────────────────┘
           │
           ▼ (after approval)
┌──────────────────────────────────────┐
│     SIDEBAR NAVIGATION (Drawer)      │
│  ┌────────────────────────────────┐  │
│  │ ● DASHBOARD (Radar Map)        │  │
│  │ ● EARNINGS (Yield Dashboard)   │  │
│  │ ● WALLET                       │  │
│  │ ● SCHEDULED RIDES              │  │
│  │ ● STRATEGY SETTINGS            │  │
│  │ ● PROFILE                      │  │
│  │ ● REPORT ISSUE                 │  │
│  │ ● LEGAL                        │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### 4.2 DashboardScreen — The Tactical HUD

This is the driver's primary interface — always on, always visible.

**HUD Zones:**

```
┌──────────────────────────────────────────────────┐
│  TOP BAR: Status (Online/Offline toggle)         │
│  ┌────────────┐  ┌──────┐  ┌───────────────┐    │
│  │ ● ONLINE   │  │ $245 │  │ 4.8 ★  (234)  │    │
│  │ [toggle]   │  │today │  │ rating/rides  │    │
│  └────────────┘  └──────┘  └───────────────┘    │
├──────────────────────────────────────────────────┤
│  CENTER: RADAR MAP (full-bleed Mapbox view)       │
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │   [Heatmap of nearby demand clusters]    │    │
│  │   [Ghost car markers — other drivers]    │    │
│  │   [Your GPS dot + heading cone]          │    │
│  │   [Offer popup when ride comes in]       │    │
│  └──────────────────────────────────────────┘    │
├──────────────────────────────────────────────────┤
│  BOTTOM: Strategy Bar                             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ SURGE  │ │ AREA   │ │ VEHICLE│ │ SR %   │    │
│  │ +2.3x  │ │ City C │ │  XL    │ │ 92%   │    │
│  └────────┘ └────────┘ └────────┘ └────────┘    │
└──────────────────────────────────────────────────┘
```

**Online/Offline State Machine:**
```
        ┌──────────┐
        │  OFFLINE │◄──────────┐
        └────┬─────┘          │
             │ tap "Go Online" │
             ▼                 │
        ┌──────────┐          │
        │  ONLINE  ├──────────┤
        │(scanning)│  tap "Go │
        └────┬─────┘  Offline"│
             │ match received │
             ▼                 │
        ┌──────────┐          │
        │ OFFERED  │          │
        │(15s TTL) ├──────────┤
        └────┬─────┘  decline │
             │ accept         │
             ▼                 │
        ┌──────────┐          │
        │ASSIGNED  │          │
        └──────────┘          │
             │ complete ride  │
             ▼                 │
        ┌──────────┐          │
        │ COMPLETED│──────────┘
        └──────────┘  auto-return
                       to ONLINE
```

### 4.3 Passenger Pickup Flow

```
[Online/Radar] → Offer popup (15s countdown, fare, distance, rider rating)
  → Accept → TripRequestScreen (rider info, pickup nav, ETA)
    → Arrive → ActiveTripScreen (rider pickup verification code/NFC)
      → Start Trip → Navigation to dropoff (turn-by-turn via Mapbox)
        → Complete → Auto-settlement + EarningsScreen update
```

### 4.4 Merchant Package Pickup Flow

```
[Online/Radar] → Offer popup (marked "PACKAGE" badge, merchant name)
  → Accept → TripRequestScreen (merchant location, package details)
    → Arrive at Merchant → Verify handoff via NFC/QR (verify_handoff fn)
      → Package in vehicle → Navigation to delivery address
        → Dropoff → Customer signs → Complete
```

This is a **distinct flow** from passenger pickup. The driver's UI changes to show:
- Package count instead of passenger name
- Merchant contact instead of rider contact
- No rating screen (merchant rates the delivery, not the driver)

### 4.5 Earnings Yield Dashboard

```
EarningsScreen
  ├── Today: $245 (12 rides, 8h online)
  ├── This Week: $1,420 (projected: $1,800)
  ├── This Month: $5,200
  ├── Charts: hourly breakdown, day-of-week heatmap
  └── Payout: $180 available (next payout: Fri)
```

**Data fed by:** `platform_revenue_logs` + `wallet_transactions` — displayed via the earnings query pattern in `complete_ride` settlement math.

### 4.6 Strategy Settings

```
StrategySettingsScreen
  ├── Target Area (selected zone from map)
  ├── Vehicle Type Preference (Standard/XL/Premium)
  ├── Minimum Fare Threshold ($5/$10/$15)
  ├── Auto-Accept Below Distance (offer auto-accept if < 2km away)
  └── Do Not Disturb Mode (suppress offers during break)
```

---

## 5. App 3: The Merchant App (Enterprise Portal)

### 5.1 Current State vs. Required State

**Currently exists (3 screens):**
- `LoginScreen` — Auth
- `DashboardScreen` — Basic order list
- `RegisterScreen` — Merchant registration
- `OrdersScreen` — Live orders

**Required to be production-ready:**

```
┌───────────────────────────────────────────────┐
│                MERCHANT TAB NAV               │
│  ┌─────────┐ ┌─────────┐ ┌────────┐ ┌──────┐ │
│  │ ORDERS  │ │ MENU    │ │ANALYTIC│ │ MORE │ │
│  │ (live)  │ │(inventory│ │ S      │ │      │ │
│  └─────────┘ └─────────┘ └────────┘ └──────┘ │
└───────────────────────────────────────────────┘
```

### 5.2 Order Ingestion & Management

```
DashboardScreen (default tab: ORDERS)
  ├── Pending Orders (new, needs acceptance)
  │   ├── Order detail: items, customer, delivery distance
  │   ├── Accept → triggers match_order_delivery
  │   └── Reject → auto-decline to rider
  ├── Preparing Orders (accepted, being fulfilled)
  │   ├── Items list with check-off
  │   ├── Add wait time estimate
  │   └── Mark Ready → notify available drivers
  ├── Courier Assigned
  │   ├── Driver info, live ETA
  │   └── NFC/QR handoff when driver arrives
  └── Completed (history view)
```

**Edge function wiring:**
- `merchant_gateway` — Accept/reject gateway
- `merchant_dispatch` — Dispatch to driver pool
- `merchant_order_picker` — Order fulfillment tracking
- `merchant_update_order_status` — Status transitions
- `verify_handoff` — NFC/QR courier handoff verification

### 5.3 Inventory/Menu Management

```
MenuScreen (tab 2)
  ├── Categories (add/edit/reorder)
  ├── Items per category
  │   ├── Name, description, price, photo
  │   ├── Availability toggle (in stock / out of stock)
  │   └── Modifier groups (size, extras)
  └── Bulk operations (import via CSV, seasonal menus)
```

### 5.4 Courier Handoff Verification

```
verify_handoff edge function:
  Driver arrives → Merchant taps "Handoff" on order card
    → NFC scan of driver's phone (nfc_event_handler)
    → OR QR code scan (VisionScannerScreen)
    → Records: driver_id, item_count, timestamp
    → Updates order status to "in_transit"
    → Realtime broadcast to rider: "Your order is on the way!"
```

### 5.5 Revenue Analytics

```
AnalyticsScreen (tab 3)
  ├── Today's Revenue (real-time)
  ├── Weekly/Monthly Trends (bar/line charts)
  ├── Top-Selling Items (sorted by volume)
  ├── Peak Hours (heatmap)
  └── Payout Status (settled vs pending from `v_merchant_revenue_summary`)
```

---

## 6. App 4: The Admin/Overwatch App (God Mode)

### 6.1 Two Surfaces

| Surface | Tech | Purpose |
|---------|------|---------|
| **Admin Web** (`apps/admin/`) | Vite + React | Full desktop command center |
| **Admin Mobile** (`apps/admin-mobile/`) | Expo + RN | On-the-go oversight |

Both share the same edge function backend and data layer.

### 6.2 Admin Web — Page Map

```
apps/admin/src/pages/
  ├── Login.tsx          — Auth gate (Phase 1 - MUST require admin role)
  ├── Dashboard.tsx      — Live grid + key metrics
  ├── DriverApproval.tsx — KYC queue
  ├── Financials.tsx     — Platform revenue, disputes, settlements
  ├── FleetManager.tsx   — Driver fleet management, penalties
  ├── NodeRegistry.tsx   — NFC puck inventory + deployment
  └── RescueScreen.tsx   — Emergency override panel
```

### 6.3 Live Grid Monitoring (Dashboard.tsx)

```
┌─────────────────────────────────────────────────────┐
│  TOP BAR: KPI TILES                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ │
│  │LIVE  │ │PEN-  │ │ ACT  │ │ REV  │ │ ACTIVE   │ │
│  │RIDES │ │DING  │ │DRIVRS│ │TODAY │ │ ALERTS 3 │ │
│  │  142 │ │ 12   │ │  87  │ │$3.2K │ │          │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘ │
├─────────────────────────────────────────────────────┤
│  CENTER: MAPBOX GRID (full-width)                    │
│  ├── Live driver GPS dots (color-coded: avail/busy) │
│  ├── Active ride polylines                           │
│  ├── Heatmap overlay for demand density              │
│  ├── Merchant pins with live wait times              │
│  └── Alert overlays (SOS, spoof flag, detour)        │
├─────────────────────────────────────────────────────┤
│  SIDE PANEL: Event Feed (Realtime stream)            │
│  ├── ride_events in chronological order              │
│  ├── Filter by event_type, severity, actor           │
│  └── Click to zoom map to location                   │
└─────────────────────────────────────────────────────┘
```

### 6.4 Algorithmic Penalty Management (FleetManager.tsx)

Automated by the `update_driver_location` function's spoof detection but overridable here:

```
Penalty Queue:
  ├── GPS Spoof Flags (from gps_spoof_log)
  │   ├── Driver ID, incident count, max speed
  │   ├── Action: warn | suspend (24h) | ban
  │   └── Auto-escalation: 3 flags → auto-suspend
  ├── Cancellation Abuse (high cancellation rate)
  │   ├── Driver, cancellation %, revenue impact
  │   └── Action: fee waiver | suspend | ban
  └── Rider Fraud (fake trip reports)
      ├── Rider, report count, evidence
      └── Action: warn | restrict | ban
```

**Edge function wiring:** `admin_toggle_driver` (suspend/activate), `admin_toggle_flag` (escalate/clear), `admin_toggle_role` (elevate/demote)

### 6.5 Manual Dispatch Override (RescueScreen.tsx)

```
RescueScreen
  ├── Active Ride Search
  │   ├── Input: ride_id, rider name, driver name
  │   └── Result: current ride state, timeline, events
  ├── Override Controls:
  │   ├── Cancel Ride → admin_cancel_ride (writes to admin_audit_log)
  │   ├── Force Complete → admin_force_complete (with reason)
  │   ├── Reassign Driver → admin_assign_driver
  │   ├── Refund Rider → admin_refund
  │   └── Suspend User → admin_suspend_rider
  └── Audit Trail: every override logged to admin_audit_log table
```

### 6.6 Platform Revenue Analytics (Financials.tsx)

```
FinancialsScreen
  ├── Revenue Summary (from platform_revenue_logs)
  │   ├── Gross fare volume (daily/weekly/monthly)
  │   ├── Platform fees collected (18.5% net)
  │   ├── War Chest reserve (1.5%)
  │   ├── Lease deductions
  │   └── Driver payouts
  ├── Payment Ledger (all transactions)
  ├── Wallet → Debt Settlement (admin_settle_debt)
  ├── Stripe Settlement Status (captured vs pending)
  └── Export (CSV/PDF)
```

### 6.7 Admin Mobile — Pocket Overwatch

Minimal mobile surface for urgent actions:
- `DashboardScreen` — Condensed KPI view + live event feed
- `LoginScreen` — Admin auth
- `TagMarkerScreen` — Register NFC pucks in the field

---

## 7. Cross-App Integration Matrix

| Event | Source App | Backend Action | Target App(s) | Protocol |
|-------|-----------|---------------|---------------|----------|
| Ride requested | Rider | `create_ride` → DB insert | Driver (offer) | Realtime + Push |
| Ride accepted | Driver | `accept_ride` → status change | Rider, Admin | Realtime + Push |
| Ride completed | Driver | `complete_ride` → settlement | Rider, Admin | Realtime + Push |
| Order placed | Rider | `merchant_gateway` | Merchant | Realtime + Push |
| Order ready | Merchant | `merchant_dispatch` | Driver | Realtime + Push |
| Handoff verified | Merchant | `verify_handoff` | Rider, Driver | Realtime + Push |
| SOS triggered | Driver | `trigger_emergency` | Admin | Push + Realtime alert |
| Payment failed | Stripe | `stripe_webhook` | Rider | Realtime + Push |
| Wallet top-up | Rider | `create_wallet_topup` | Rider (wallet) | Realtime |
| Driver suspended | Admin | `admin_toggle_driver` | Driver | Push + Realtime |
| NFC puck tap | Rider | `nfc_event_handler` | Rider (auto-ride) | Direct |

---

## 8. State Flow Orchestration

### 8.1 Ride State Flow (Full Graph)

```
                  ┌──────────┐
                  │ REQUESTED│
                  └────┬─────┘
                       │ (match_driver starts search)
                       ▼
                  ┌──────────┐
           ┌──────│ SEARCHING│──────┐
           │      └──────────┘      │
           │ (10s no match)         │ (match found)
           ▼                        ▼
     ┌──────────┐            ┌──────────┐
     │  EXPIRED │            │ WAITING  │
     └──────────┘            │ _QUEUE   │
                             └────┬─────┘
                                  │ (driver accepts)
                                  ▼
                             ┌──────────┐
                   ┌─────────│ ASSIGNED │─────────┐
                   │         └────┬─────┘         │
                   │              │                │
                   │ (driver      │ (driver        │ (rider/
                   │  cancels)    │  arrives)      │  driver cancels)
                   ▼              ▼                ▼
             ┌──────────┐   ┌──────────┐    ┌──────────┐
             │ CANCELLED │   │ ARRIVED  │    │ CANCELLED │
             └──────────┘   └────┬─────┘    └──────────┘
                                 │ (trip starts)
                                 ▼
                            ┌──────────┐
                            │IN_PROGRES│
                            │   S      │
                            └────┬─────┘
                                 │ (driver completes)
                                 ▼
                            ┌──────────┐
                            │ COMPLETED│
                            └────┬─────┘
                                 │ (payment captured)
                                 ▼
                            ┌──────────┐
                            │ PAYMENT_ │
                            │ CONFIRMED│
                            └────┬─────┘
                                 │ (rider rates + closes)
                                 ▼
                            ┌──────────┐
                            │  CLOSED  │
                            └──────────┘
```

Each transition is enforced at three layers:
1. Database CHECK constraint (`validate_ride_status_transition` trigger)
2. Edge function `.in('status', [...])` guard
3. Realtime broadcast notifies all subscribers

### 8.2 Order/Delivery State Flow

```
ORDER_PLACED → MERCHANT_ACCEPTED → PREPARING → READY_FOR_PICKUP →
  COURIER_ASSIGNED → IN_TRANSIT → DELIVERED → COMPLETED
```

Handled by: `merchant_gateway` → `merchant_update_order_status` → `match_order_delivery` → `verify_handoff`

### 8.3 Payment State Flow

```
RIDE CREATED                         RIDE COMPLETED
  │ payment_status: 'pending'          │
  │                                    │
  │ ┌── Wallet ──────────────────┐     │
  │ │ process_wallet_payment()   │     │
  │ │ SELECT ... FOR UPDATE      │     │
  │ │ balance--, wallet_txns++   │     │
  │ │ payment_status: 'captured' │     │
  │ └────────────────────────────┘     │
  │                                    │
  │ ┌── Card (Stripe) ───────────┐     │
  │ │ create_payment_intent fn   │     │
  │ │ -> PI created (authorized) ├─────┤
  │ │ <- client_secret to app    │     │
  │ │ -> App confirms PI         │     │
  │ │ <- webhook: captured       │     │
  │ │ payment_status: 'captured' │     │
  │ └────────────────────────────┘     │
  │                                    │
  │ ┌── Cash ────────────────────┐     │
  │ │ cash_confirmed = true      │     │
  │ │ shadow ledger entry        │     │
  │ │ payment_status: 'captured' │     │
  │ └────────────────────────────┘     │
  ▼                                    ▼
PAYMENT_CONFIRMED → receipt_sent → CLOSED
```

### 8.4 Outbox Reconciliation (Offline Safety Net)

```
┌───────────────────────────────────────────────────────┐
│                   OFFLINE SCENARIO                     │
│                                                       │
│  Driver completes ride but has no signal              │
│                                                       │
│  1. Driver app stores pending completion in           │
│     AsyncStorage (OutboxService.push)                 │
│                                                       │
│  2. BackgroundFetch task (RETRY_TASK) fires every     │
│     30s, attempts to replay                           │
│                                                       │
│  3. On reconnect, OutboxService drains queue:         │
│     POST /functions/v1/complete_ride  (success)       │
│     → queue item removed                              │
│     → ride status set to 'completed'                  │
│     → settlement math runs server-side                │
│     → push notification sent to rider                 │
│     → Realtime broadcast updates all clients          │
│                                                       │
│  4. If server returns 409 (already completed),        │
│     drop the item (idempotent via ride_id check)      │
└───────────────────────────────────────────────────────┘
```

---

## 9. Pending Implementation Backlog

This is the work **not covered by Phases 1–13** that remains for production readiness.

### 9.1 Screens Missing or Incomplete

| App | Screen | Status | What's Needed |
|-----|--------|--------|---------------|
| Merchant | Menu/Inventory | ❌ Not built | Full CRUD UI for menu items, categories, pricing, photos |
| Merchant | Analytics | ❌ Not built | Revenue charts, MSL analysis, payout status |
| Merchant | Courier Handoff | ❌ Not built | NFC/QR verification UI on order detail |
| Admin Web | Dashboard live grid | ⚠️ Partial | Mapbox integration on admin, live Realtime feed |
| Admin Web | Financials | ❌ Not built | Revenue analytics dashboard |
| Admin Web | Fleet Manager | ❌ Not built | Penalty management UI |
| Admin Web | Rescue Screen | ⚠️ Partial | Need all override controls wired |
| Admin Mobile | Dashboard | ❌ Not built | Pocket dashboard with condensed KPIs |
| Rider | Subscription | ⚠️ Partial | Stub exists, needs Stripe recurring payment |
| Driver | Strategy Settings | ⚠️ Partial | UI exists, needs to persist to drivers table |

### 9.2 Data Reconciliation Layer

No system currently detects desyncs between:
- Stripe captured amounts vs `payment_ledger` entries
- Redis driver GPS cache vs `driver_locations` table
- Wallet balances vs `wallet_transactions` summed

Need a `reconciliation_job` edge function (scheduled via pg_cron) that runs daily:
```
SELECT cron.schedule('reconciliation-job', '0 6 * * *', $$
  -- Detect Stripe/PG mismatches
  SELECT * FROM payment_ledger pl
  LEFT JOIN stripe_events se ON pl.stripe_event_id = se.id
  WHERE pl.provider = 'stripe' AND se.id IS NULL;

  -- Detect wallet balance drift
  SELECT user_id, balance - calculated_balance AS drift
  FROM wallets
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(amount), 0) AS calculated_balance
    FROM wallet_transactions WHERE user_id = wallets.user_id
  ) calc
  WHERE ABS(balance - calculated_balance) > 0;
$$);
```

### 9.3 Design System Audit

| Token Category | Rider | Driver | Merchant | Admin |
|---------------|-------|--------|----------|-------|
| Color (`SURFACE`) | 🟢 | 🟢 | 🔴 missing | 🔴 missing |
| Typography (`VOICES`) | 🟢 | 🟢 | 🟢 | 🟢 |
| Component Library | 🟡 partial | 🔴 none shared | 🔴 none | 🟢 web-only |
| Dark Mode Support | 🟢 | 🟢 | 🔴 | 🔴 |
| Accessibility (a11y) | 🔴 | 🔴 | 🔴 | 🔴 |

### 9.4 E2E Testing Gap

| Layer | Coverage | Tool |
|-------|----------|------|
| DB triggers (state machine) | ✅ 18 tests | Deno test runner |
| Edge functions | ❌ None beyond state machine | Supabase local testing |
| Rider app | ❌ None | Detox or Maestro |
| Driver app | ❌ None | Detox or Maestro |
| Admin web | ❌ None | Playwright |
| Cross-app integration | ❌ None | Manual |

### 9.5 Phase 13 App Store Requirements

```
☐ Privacy policy URL live (required for both stores)
☐ Terms of service URL live (required for both stores)
☐ App Store Connect: app listing, screenshots, description
☐ Google Play Console: store listing, content rating
☐ Data safety section (Google Play) — what data is collected, why
☐ Privacy nutrition labels (App Store) — data categories used
☐ Test accounts created for app review teams
☐ EAS Build: production builds signed with distribution certs
☐ iOS: App Store submission via Transporter/Xcode
☐ Android: Play Store submission via EAS Submit or direct APK
```

---

**End of Phase 1 Ecosystem Map.** Awaiting approval before any frontend UI generation begins.
