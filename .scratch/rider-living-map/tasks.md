# Rider living map — task breakdown (2026-10-25)

Plan: ~/.claude/plans/system-reminder-the-git-worktree-buzzing-torvalds.md
Branch: feat/rider-design-foundation (wt2). One task = one commit, green tsc + jest first.

Each task's commit must pass:
- `cd apps/rider && npx tsc --noEmit`
- `cd apps/rider && npx jest`

Facts proven before planning (live DB, read-only, 2026-10-25):

- **Shops:** riders can read active merchants. 2 are active and have a
  location.
- **Shop subscriptions:** `merchant_subscriptions` is admin-only, so riders
  cannot see who subscribes. The rider-readable "paid" signal is
  `g_rank_merchants.is_featured` / `get_nearby_merchants.is_promoted`.
  Both come from `merchant_promotions` and are billed per impression;
  there are 0 rows today.
- **Touch points:** `kiosk_nodes` is rider-readable when
  `lifecycle_status` is live or activated, but 0 such rows have a location.
  So the layer is built but shows nothing today.
- **Heat:** the `driver_heatmap` demand path is driver-JWT only. The
  rider-callable path is `type=safety`, which is a safety status, not a
  busy-area signal. The busy-heat layer is SKIPPED, not faked.
- **Cars:** `nearby_driver_dots` RPC, polled every 30s in
  `hooks/useNearbyDrivers.ts`.
- **Push taps:** `AuthContext.tsx` notification-tap listener only logs.
  Taps go nowhere, and a cold-start tap is not read at all.
- **`ride_stops`:** has no `order_id` / `merchant_id`. "Driver grabs it"
  needs a migration, which is the founder's decision.

## T1 — Bottom tabs + You page (retire Sidebar + hamburger)
Depends on: none.
- [ ] `@react-navigation/bottom-tabs@7.2.0` installed. It peers with
      native ^7.0.14, which matches the installed 7.0.14.
- [ ] A `MainTabs` stack screen holds Home · Services · Activity(Trips) ·
      Wallet · You(Profile).
- [ ] Every existing `navigate('Home'|'Trips'|'Wallet'|'Profile')` still
      lands correctly.
- [ ] Deep link `gtaxi://request` still reaches Home.
- [ ] Custom 3D kit tab bar. Nothing overlaps it, and screens pad for it.
- [ ] The You page shows tiles for Settings, Saved places, Notifications,
      Promotions, Invite, Help and Sign out. Each tile opens its page.
- [ ] `Sidebar.test.tsx` is replaced by a `YouScreen` test covering the
      same destinations.

## T2 — Push-tap routing (cold + warm)
Depends on: T1.
- [ ] The tap handler routes by payload type to the right screen
      (ride → ActiveRide/Receipt, order → order status, SOS/guardian →
      ActiveRide). An unknown type opens Notifications.
- [ ] A cold start uses `getLastNotificationResponseAsync` after the
      navigator is ready.
- [ ] A unit test covers the payload→route mapping.

## T3 — Drag sheet with 3 snap points
Depends on: T1.
- [ ] Snap points: peek, half, full. Uses gesture-handler + reanimated,
      checked against the installed versions' docs.
- [ ] `GestureHandlerRootView` wraps the app.
- [ ] `mapPadding.bottom` tracks the sheet, so pins never sit under it.
- [ ] A unit test covers the snap-point selection (the nearest point,
      with velocity bias).

## T4 — Shop carousel + pins + action card
Depends on: T3.
- [ ] Shop pins: featured ones get a logo and a slow pulse; the rest get
      a small dot.
- [ ] The carousel order is "mix, paid boosted": featured first by
      distance, then the rest by distance. This is a pure function with a
      test.
- [ ] Snapping to a card makes the map fly to that shop, and its pin
      grows.
- [ ] Tapping a pin or card opens the action card with 4 actions:
      Ride there, Stop on my way, Driver grabs it (coming soon),
      Deliver to me.
- [ ] Sparse state is a designed "Shops near you are joining" card. It
      never names a specific shop.

## T5 — Gliding cars + G-Touch Points layer
Depends on: T3.
- [ ] Cars interpolate between polls.
- [ ] Touch-point pins show from rider-readable `kiosk_nodes` (0 today,
      so verified empty).

## T6 — Usual next trip chip
Depends on: T3.
- [ ] Pure function: the most frequent completed destination for this
      time band. Tested. Hidden when there's no history.

## T7 — Menu pages audit (12 pages)
Depends on: T1.
- [ ] Pages: Trips, Wallet, WalletTopUp, SavedPlaces, Notifications,
      Promo, Referral, Settings, EditProfile, Help, Payment, Receipt.
- [ ] Each page passes 4 checks: works with no user and with an empty
      list; has back or a tab; no overlap; follows the kit.

## T8 — APK + phone checklist (definition of done)
Depends on: all of the above.

## Checkpoints
- After T1–T2: gallery screenshots, day and night.
- After T3–T4: an APK to the founder early, because the sheet and map
  gestures only prove out on a phone.
