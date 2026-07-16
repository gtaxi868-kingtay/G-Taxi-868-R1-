-- ═══════════════════════════════════════════════════════════════════
-- HEAVY VEHICLE RATE CALIBRATION FROM REAL MARKET RESEARCH (2026-07-16)
--
-- No published rate card exists for hiab/wrecker services in T&T — it is
-- a phone-quote market (confirmed across six targeted web searches: IRD,
-- FindYello, Caribbean Equipment Traders, trinituner forums, Facebook
-- classifieds — none publish rates). Two real anchoring data points:
--   1. A real 2026 T&T Facebook marketplace listing: ~TT$200 flat for a
--      local tow job — matches the wrecker min fare already seeded.
--   2. International small/medium hiab hourly comparables: AU$70-120+/hr
--      (iseekplant.com.au rate guide) — roughly TT$300-540 at approximate
--      conversion. Hiab min fare raised from $350 to $400 to sit inside
--      that range with margin for currency uncertainty.
-- Real quote contacts surfaced for follow-up: Amsha Engineering, Dave's
-- Transport & Rentals (San Fernando), Bartlett Haulage, Wreck 4 Less,
-- Aranguez Wrecking. Descriptions updated to carry this sourcing so a
-- future admin knows WHY these numbers were chosen and what to verify.
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.vehicle_classes SET description =
  'Towing & recovery. Rate anchored to a real 2026 T&T marketplace tow-job listing (~TT$200 flat, local). No published T&T rate card exists — phone-quote market. Verify against real operators (e.g. Wreck 4 Less, Aranguez Wrecking) as quotes come in.',
  updated_at = now()
WHERE key = 'wrecker';

UPDATE public.vehicle_classes SET multiplier_x100 = 450, min_fare_cents = 40000,
  description = 'Crane-arm lifts & drops. No T&T rate card published (phone-quote market). Anchored to international small/medium hiab hourly comparables (AU$70-120+/hr, roughly TT$300-540 at approximate conversion) plus margin for currency uncertainty. Real quote contacts found: Amsha Engineering, Dave''s Transport & Rentals (San Fernando), Bartlett Haulage. Adjust here once real T&T quotes are in hand.',
  updated_at = now()
WHERE key = 'hiab';

UPDATE public.vehicle_classes SET description =
  'Flatbed & cargo moves. No T&T rate card published. Estimated from general flatbed/cargo haulage patterns — lower specialization than hiab/wrecker, priced accordingly. Verify against real operator quotes as they come in.',
  updated_at = now()
WHERE key = 'truck';
