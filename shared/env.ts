// Environment configuration
// These values are safe to commit - they are public keys
// Service role key is ONLY used in Edge Functions (server-side)

export const ENV = {
    SUPABASE_URL: 'https://ffbbuafgeypvkpcuvdnv.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8',
    MAPBOX_PUBLIC_TOKEN: 'pk.eyJ1IjoidGF4aWciLCJhIjoiY21ra2U3MHpxMWRnYzNwcTBubjFvZndoOCJ9.1wZm2poSFz_YsiCPlkEZPw',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_51O2uA8I2HzP1uK1u...', // Placeholder, should be in .env
} as const;

// Trinidad & Tobago default location (Port of Spain)
export const DEFAULT_LOCATION = {
    latitude: 10.6549,
    longitude: -61.5019,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
} as const;
