-- Create saved_places table
create table if not exists public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  label text not null, -- 'Home', 'Work', 'Gym', etc.
  address text not null,
  lat double precision not null,
  lng double precision not null,
  icon text, -- Optional emoji or icon name
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  
  -- Constraint to prevent duplicate labels for same user (e.g. only one 'Home')
  unique(user_id, label)
);

-- Enable RLS
alter table public.saved_places enable row level security;

-- Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'saved_places' AND policyname = 'Users can view own saved places'
    ) THEN
        create policy "Users can view own saved places"
        on public.saved_places for select
        using ((select auth.uid()) = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'saved_places' AND policyname = 'Users can insert own saved places'
    ) THEN
        create policy "Users can insert own saved places"
        on public.saved_places for insert
        with check ((select auth.uid()) = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'saved_places' AND policyname = 'Users can update own saved places'
    ) THEN
        create policy "Users can update own saved places"
        on public.saved_places for update
        using ((select auth.uid()) = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'saved_places' AND policyname = 'Users can delete own saved places'
    ) THEN
        create policy "Users can delete own saved places"
        on public.saved_places for delete
        using ((select auth.uid()) = user_id);
    END IF;
END $$;

-- Enable Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'saved_places'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.saved_places;
    END IF;
END $$;
