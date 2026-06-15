# G-Taxi — Product Context

## What it is
A ride-hailing platform for Trinidad and Tobago. Four apps sharing one Supabase backend.

## The apps
- **Rider** (`apps/rider`) — Book rides, order groceries, book laundry, scan NFC kiosks, buy Caribbean travel packages via G-Escape
- **Driver** (`apps/driver`) — Go online, accept trips, manage earnings, sign BYD lease addendum
- **Merchant** (`apps/merchant-mobile`) — Manage NFC kiosk orders, dispatch rides for clients, view vendor earnings
- **Admin** (`apps/admin`) — Approve drivers, manage pricing, view the war chest reserve, settle bank escrow

## Users
- **Rider**: T&T resident, 18–45, Android-first (Qualcomm 6xx series common), active 6–10am and 4–8pm commute hours
- **Driver**: Freelance, income-motivated, values transparency on earnings and deductions before every dollar is credited
- **Merchant**: Shop owner operating an NFC kiosk, wants fast dispatch visibility and vendor commission tracking
- **Admin**: G-Taxi operations team — needs full financial visibility, fleet oversight, and one-click payout approval

## Visual identity
- Dark-first. The map IS the interface for rider and driver; every overlay is an interruption that must earn its place.
- **Cyan** (`#00FFFF`) — ride speed, real-time data, the pulse of the system
- **Gold** (`#D4AF37`) — G-Escape premium travel, BYD lease, high-value moments
- **Purple** (`#BF40FF`) — AI suggestions, AI intelligence layer
- **Amber** (`#F59E0B`) — groceries/market warmth
- Background is near-black obsidian (`#050505`); card surfaces are `rgba(255,255,255,0.04)` — just enough to lift

## Design rules
- Every animation must run on the UI thread (react-native-reanimated). Never the JS thread.
- G-Escape is a premium vertical — gold treatment, not a utility chip. Treat it like a travel concierge.
- NFC/Tap is a utility feature — compact chip, not a full grid card. Technical, small, precise.
- Blur effects use `expo-blur` on iOS only. Android gets a rich dark solid substrate (no CSS backdropFilter).
- Press states follow Emil Kowalski's principle: scale 0.97 on active, ease-out. Nothing appears from nothing.
- `accessibilityLabel` and `accessibilityRole` are required on every TouchableOpacity.

## Tech stack
- Expo SDK 52, React Native, TypeScript
- Supabase Postgres + Realtime + Edge Functions (Deno, 23 functions)
- react-native-reanimated for all animations
- Design tokens live in `packages/design-system-native/src/theme.ts` (VOICES, BRAND, SEMANTIC, SPACING, RADIUS)

## register
product

## Users

**Riders** — T&T residents and visitors requesting taxis. Context: outdoors, one hand on phone, often in sun glare. Primary task: book a ride from current location in under 3 taps.

**Drivers** — Registered G-Taxi drivers managing their availability and earnings. Context: in vehicle, phone mounted, quick-glance interactions. Primary task: toggle online status; see and accept incoming ride offers.

**Admins** — Platform operators monitoring the live fleet, approving drivers, managing pricing and disputes. Context: desktop browser, sustained work sessions. Primary task: real-time fleet oversight and operational control.

**Merchants** — Vendors (grocery, laundry, hotels, property owners) managing orders, dispatch, and earnings. Context: on mobile at their business premises. Primary task: see incoming orders and manage commissions.

## Product Purpose

G-Taxi is a vertically integrated ride-hailing and logistics platform for Trinidad and Tobago. It does not just move people — it moves goods, coordinates merchants, operates travel packages, and accumulates financial leverage through a capital reserve system. Success looks like: a rider books a ride in 3 seconds, a driver earns without a bank account, a merchant grows commission income, and the platform compounds its own reserve into fleet equity.

## Brand Personality

**Precise. Grounded. Fast.** Not flashy for its own sake. The product is ambitious but the UI should feel like a professional tool — one that operators in T&T trust at 11pm when they need a ride now. The aesthetic is dark, deliberate, and local. It is not Uber. It is not a startup landing page. It is a platform with a point of view.

## Anti-references

- Uber / Bolt home screens — their teal-on-white look is category default; do not resemble it
- SaaS dashboard templates — glass card grids, metric hero blocks, "Operational Velocity" jargon
- Generic dark-mode apps — obsidian dark that could belong to any crypto, fintech, or gaming app; this platform has T&T identity
- All-caps-everything interfaces — using ALL CAPS for every label, heading, and tag simultaneously drains emphasis from everything

## Design Principles

1. **One action per screen.** The rider is booking a ride. The driver is going online. The merchant is checking orders. Nothing competes with the primary action.
2. **Earn the darkness.** Dark backgrounds work when the accent color carries full weight. Cyan and purple must be used sparingly enough that they still mean something when they appear.
3. **Text that speaks first.** Labels should say exactly what they do — plain English. Not "Operational Velocity," not "Event Trace." "Active rides." "Today's trips." The interface serves T&T users, not a Silicon Valley demo.
4. **State over decoration.** Animations should reveal state (online/offline, loading, arrived) — not loop indefinitely as ambient decoration.
5. **Consistent vocabulary.** Button shapes, icon styles, form controls, and text sizes must be identical across every screen. Inconsistency is the fastest way to feel amateur.

## Accessibility & Inclusion

- WCAG AA minimum (4.5:1 for body, 3:1 for large text)
- Reduced motion alternatives for all animations (especially the driver car spin and pulse)
- Touch targets ≥ 44×44pt on all interactive elements
- Teal/cyan accent must pass contrast on dark surfaces — verify at each use
