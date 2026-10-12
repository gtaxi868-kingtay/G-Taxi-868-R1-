-- ═══════════════════════════════════════════════════════════════════
-- Where a G-Touch Point chip's tap link points.
--
-- Until now no code wrote anything onto an NFC chip: provisioning only
-- READ the factory serial number. A blank chip does nothing for a phone
-- without the G app open on its scan screen, and an iPhone can't react to
-- one in the background at all. The admin app now writes
--   <nfc_tap_base_url>?node=<kiosk_nodes.id>
-- onto each touch-point chip, so any phone opens the landing page
-- (apps/qr-landing already resolves ?node= via the `site` function).
--
-- Kept as config, not code: gtaxi.tt does not resolve yet (no DNS, checked
-- 2026-10-11), so this starts on the landing page's current Vercel
-- address. Change this row when the real domain is live -- before locking
-- any chips, since a locked chip's link can never change.
-- node id (not the chip serial) goes in the link so the serial used by
-- verify_kiosk_origin is never printed in a public URL.
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.system_config (key, value, description, updated_at)
VALUES (
  'nfc_tap_base_url',
  'https://g-taxi-868-r1-admin.vercel.app/tap',
  'Base URL written onto G-Touch Point NFC chips as <value>?node=<kiosk node id>. Change to the real domain before locking chips.',
  now()
)
ON CONFLICT (key) DO NOTHING;
