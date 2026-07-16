-- NEUTRALIZED 2026-07-16 — DO NOT RESTORE THE ORIGINAL BODY.
--
-- Goal (commander 2% paid from the driver pool, keyed on the DRIVER's
-- profile) was ALREADY live in compute_ride_split since settlement model v2
-- (2026-07-05). The original body re-implemented it inside the retired
-- record_pool_entry with different math. The real residual bug — the
-- rider-keyed commander block in complete_ride double-paying commanders —
-- was fixed directly in complete_ride/index.ts on 2026-07-16.
SELECT 1;
