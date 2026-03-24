-- BULLETPROOF ADMIN INITIALIZATION
-- This script avoids ON CONFLICT issues and ensures the operator account is fully provisioned.

DO $$
DECLARE
    v_user_id UUID;
    v_email TEXT := 'gtaxi868@gmail.com';
    v_pass TEXT := 'kingkey868';
BEGIN
    -- 1. Check if user already exists in auth.users
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

    -- 2. If not, create them
    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, 
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
            created_at, updated_at
        ) VALUES (
            v_user_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            v_email,
            crypt(v_pass, gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}',
            '{"name":"System Operator"}',
            now(),
            now()
        );
    END IF;

    -- 3. Ensure the profile exists in public.profiles and has the admin role
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
        INSERT INTO public.profiles (id, full_name, email, role)
        VALUES (v_user_id, 'G-Taxi Administrator', v_email, 'admin');
    ELSE
        UPDATE public.profiles SET role = 'admin', email = v_email WHERE id = v_user_id;
    END IF;

    RAISE NOTICE 'Admin user % initialized with ID %', v_email, v_user_id;
END $$;
