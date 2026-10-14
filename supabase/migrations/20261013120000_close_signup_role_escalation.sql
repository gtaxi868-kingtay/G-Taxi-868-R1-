-- ═══════════════════════════════════════════════════════════════════
-- Close: anyone can sign up as an admin.
--
-- handle_new_user_profile() (trigger on auth.users) copied the role
-- straight from raw_user_meta_data -- which is whatever the CLIENT sends
-- in supabase.auth.signUp({ options: { data: { role } } }). Public
-- sign-up is enabled and needs no email confirmation (auth settings:
-- disable_signup=false, mailer_autoconfirm=true), so one hand-made
-- request with role:"admin" yields an instant admin profile, which passes
-- every requireAdmin() check (approvals, payouts, pricing, driver
-- approval, user data).
--
-- PROVEN (rolled back, 2026-10-13): an auth.users insert with metadata
-- role "admin" produced profiles.role = admin. Not exploited so far:
-- both live admin accounts (Apr 2026) got their role some other way.
--
-- Fix: sign-up may only ever produce 'rider' or 'driver'. Every
-- legitimate privileged role is already granted server-side AFTER the
-- account exists (merchant_signup, merchant_register_with_code, admin
-- create_merchant_user upsert role 'merchant'; commander promotion
-- updates role 'pod_commander'), so nothing real depends on this.
-- Dry run (rolled back): admin/merchant/pod_commander requests -> rider;
-- driver -> driver; rider -> rider; the server-side merchant upsert still
-- yields merchant.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    -- Client-supplied metadata may only choose rider or driver. Merchant,
    -- pod_commander and admin are granted by server code, never by sign-up.
    CASE WHEN NEW.raw_user_meta_data->>'role' = 'driver'
         THEN 'driver'::public.user_role
         ELSE 'rider'::public.user_role
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
