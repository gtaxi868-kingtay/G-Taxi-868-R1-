# Business console + hotel/airline loop (2026-10-26)

Founder decisions (2026-10-26, answering after the Connection Map):
- Follow the Connection Map order AND build hotel payouts + live flight tracking now.
- Hotel room rates from ALL three: hotel sets its own, Booking.com (when approved), hotel's own website link.
- Flight status provider: FlightAware AeroAPI (founder sets secret `FLIGHTAWARE_AEROAPI_KEY`).

Facts checked live 2026-10-26:
- 12 merchants, 6 have a login (profiles.merchant_id). 3 hotels (lodging_nodes), 0 linked to a merchant.
- merchant_invites (token, merchant_id, status, claimed_at, expires_at) exists, 0 rows. merchant_register_with_code claims.
- airline_flights (flight_number, status, eta, gate) exists, 0 rows. No flight-status code anywhere; Amadeus = prices only.
- merchant_payout_accounts, payout_requests, merchant_wallet_balance exist.
- merchant-mobile PropertyManagementScreen writes to RETIRED travel_properties/travel_bookings (dead since Travel merged into Escape).
- 0 rides billed_to_merchant_id. Book-for-guest = merchant fn `dispatch_client` / `concierge_dispatch`.
- Edge functions: project at the plan cap -> fold new work into existing functions.

## Slices (one commit each, tests green, PROVEN/CLAIMED)
0. Selfie phone test fixes (waiting on founder's report). Outranks everything.
1. Hotel self-serve: link hotel <-> merchant via claim code; merchant reads/sets own room rate (quote fields) on web + mobile; fix PropertyManagementScreen to lodging_nodes.
2. Console visibility: guest rides (billed to me), drivers I brought, my profile/touch point.
3. Hotel website rate reader: hotel gives its own rate-page link; server reads it (LLM via _shared/llm.ts budget) -> SUGGESTED rate; hotel or admin confirms. Never auto-publishes.
4. Booking.com: rewrite sync_lodging_availability to fill lodging_nodes quotes; inert until BOOKING_API_KEY + partner approval. CLAIMED until a key exists.
5. FlightAware: flight status lookup + cache in airline_flights; hotel guest airport pickup with flight number; pickup time follows the real arrival. Cron refresh.
6. Hotel payout: hotel sees what it is owed; payout request -> admin approves in g_proposed_actions -> manual bank transfer marked paid. Money path: dry-run in rolled-back tx.
7. WhatsApp intake queue (admin). Token is invalid -> manual structured log, say so.
8. NFC tag gate: founder programs 2 tags; we verify tap -> booking intent.
9. Reports: payments options (WiPay/Stripe/UPI), airport meet-and-greet SOP.

Rules: no deploy / no live DB change without founder's word; migrations applied by founder via scripts/apply_migration.py.
