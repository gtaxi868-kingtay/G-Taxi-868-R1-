-- Master Fix Part 1: Admin Role Enforcement (Gap 16)
-- Adding is_admin column securely Default false.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Auto-promote the primary project owner based on email
UPDATE public.profiles SET is_admin = true WHERE email IN ('king263tay@gmail.com');

-- Add the missing flags to the existing table created in Phase 8
INSERT INTO public.system_feature_flags (id, is_active, description) VALUES
    ('driver_registration_active', true, 'Allows new drivers to sign up on the Driver App. Turn off to enable Waitlist mode.'),
    ('promo_codes_active', false, 'Enables riders to enter promo codes for discounts.')
ON CONFLICT (id) DO NOTHING;
