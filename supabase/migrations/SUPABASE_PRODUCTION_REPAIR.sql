-- G-TAXI MASTER DATABASE REPAIR SCRIPT
-- RUN THIS IN YOUR SUPABASE SQL EDITOR

--------------------------------------------------------------------------------
-- 1. PROFILES TABLE: THE IDENTITY CORE
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    phone_number TEXT,
    email TEXT,
    avatar_url TEXT,
    is_driver BOOLEAN DEFAULT FALSE,
    push_token TEXT,
    emergency_contact_name TEXT DEFAULT 'N/A',
    emergency_contact_phone TEXT DEFAULT 'N/A',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Force add columns if the table already existed without them
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_driver BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT DEFAULT 'N/A';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT DEFAULT 'N/A';

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Flush existing policies to avoid name conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

-- Create fresh security policies
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Allow drivers to be seen by riders
CREATE POLICY "Drivers are publicly viewable"
ON public.profiles FOR SELECT
USING (is_driver = true);

--------------------------------------------------------------------------------
-- 2. AUTOMATION: THE "AI HANDSHAKE" TRIGGER
--------------------------------------------------------------------------------
-- This function automatically creates a profile when a user signs up via Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone_number, email)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'full_name', 'Unnamed User'),
    COALESCE(new.raw_user_meta_data->>'phone', 'N/A'),
    new.email
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function every time a user is created in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

--------------------------------------------------------------------------------
-- 3. LOGISTICS INFRASTRUCTURE: RIDES TABLE
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rides (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rider_id UUID REFERENCES public.profiles(id) NOT NULL,
    driver_id UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'searching' CHECK (status IN ('searching', 'accepted', 'arriving', 'ongoing', 'completed', 'cancelled')),
    pickup_address TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    dest_lat DOUBLE PRECISION NOT NULL,
    dest_lng DOUBLE PRECISION NOT NULL,
    fare DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Riders can see their own rides"
ON public.rides FOR SELECT
USING (auth.uid() = rider_id);

CREATE POLICY "Drivers can see available rides"
ON public.rides FOR SELECT
USING (status = 'searching');

CREATE POLICY "Riders can create rides"
ON public.rides FOR INSERT
WITH CHECK (auth.uid() = rider_id);

--------------------------------------------------------------------------------
-- VERIFICATION COMMAND
--------------------------------------------------------------------------------
-- SELECT * FROM public.profiles LIMIT 5;
