-- ═══════════════════════════════════════════════════════════════════
-- Let admins actually create G-Escape packages from the admin Escape tab.
-- Applied to production 2026-10-10 with the founder's explicit approval.
--
-- flight_blocks, escape_packages and lodging_nodes each have an
-- "Admin full access" RLS policy, but authenticated only held SELECT on
-- the tables -- and RLS cannot grant what the table GRANT withholds. So
-- every write from apps/admin/src/pages/EscapeManagement.tsx (new hotel,
-- edit hotel, new flight block, new package, auto-book toggle) failed
-- with "permission denied for table ...". Verified live as a real admin
-- JWT. Net effect: nothing in the product could create an Escape package.
--
-- Grants are exactly the writes that page performs. No DELETE. Who may
-- write is still decided by RLS: the only policies permitting INSERT or
-- UPDATE on these tables are the admin ones (profiles.role = 'admin').
-- Rolled-back dry run before applying, as a real admin and a real rider:
--   admin: hotel insert (no merchant) + quote edit, flight insert,
--          package insert (priced by the real-cost triggers) -> succeed
--   rider: flight insert, hotel insert -> refused by RLS;
--          package price edit -> 0 rows changed
-- ═══════════════════════════════════════════════════════════════════

GRANT INSERT ON public.flight_blocks TO authenticated;
GRANT INSERT, UPDATE ON public.escape_packages TO authenticated;
GRANT INSERT, UPDATE ON public.lodging_nodes TO authenticated;
