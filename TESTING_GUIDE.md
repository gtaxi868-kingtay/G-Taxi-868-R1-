# G-Taxi End-to-End Simulation Guide

This guide describes how to run the automated end-to-end simulation script for the G-Taxi platform. This script verifies the complete ride lifecycle, including:

1.  **Authentication**: Tenant creation/login for Rider and Driver (auto-generated test accounts).
2.  **Ride Request**: Rider requests a ride in Port of Spain.
3.  **Driver Matching**: Driver (simulated bot) receives the offer.
4.  **Acceptance**: Driver accepts the ride (verifies atomic locking).
5.  **Ride Flow**: 
    - Driver Arrives
    - Trip Starts (In Progress)
    - Trip Completes (Fare Calculation)
6.  **Payment/Tipping**: Rider processes a tip.

## Prerequisites

- Node.js installed.
- Supabase Project is running and accessible.
- Edge Functions (`create_ride`, `match_driver`, `accept_ride`, `complete_ride`) must be deployed.
- `shared/env.ts` must contain valid `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Running the Simulation

Execute the following command from the project root:

```bash
node scripts/simulate_ride_flow.js
```

## Expected Output

You should see a sequence of green checkmarks (✅) indicating success at each stage:

```
🚀 Starting End-to-End Simulation (Admin Mode)...
...
✅ Actors Ready
[Rider] Requesting Ride...
✅ Ride Created: <UUID>. Status: searching
[Driver] Waiting for offer...
✅ Offer received automatically.
[Driver] Accepting Ride...
✅ Ride Accepted.
✅ Verification: Ride is assigned.
...
✅ Ride Completed. Final Fare: $15.00
✅ Tip processed.
🎉 SIMULATION SUCCESSFUL!
```

## Troubleshooting

-   **404 on `accept_ride`**: Check if the function is deployed: `npx supabase functions deploy accept_ride`.
-   **RLS Errors**: The script attempts to use a Service Role Key (if found) to bypass driver creation restrictions. Ensure the key in `scripts/simulate_ride_flow.js` matches your project's service role key if you rotated secrets.
-   **Timeout**: If matching takes too long, the script might retry. Ensure the driver bot is "online" and in valid range.
