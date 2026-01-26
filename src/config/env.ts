// Environment configuration
// These values are safe to commit - they are public keys
// Service role key is ONLY used in Edge Functions (server-side)

export const ENV = {
    SUPABASE_URL: 'https://kdatihgcxrosuwcqtjsi.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYXRpaGdjeHJvc3V3Y3F0anNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyOTMxNzMsImV4cCI6MjA4NDg2OTE3M30.dQ6Fm4DrKdkWHPlMGr82fPr6mWtzRVYkJ8SnLnDrTLQ',
    MAPBOX_PUBLIC_TOKEN: 'pk.eyJ1IjoidGF4aWciLCJhIjoiY21ra2U3MHpxMWRnYzNwcTBubjFvZndoOCJ9.1wZm2poSFz_YsiCPlkEZPw',
} as const;

// Trinidad & Tobago default location (Port of Spain)
export const DEFAULT_LOCATION = {
    latitude: 10.6549,
    longitude: -61.5019,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
} as const;
