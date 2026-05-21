import { initializeSupabaseClient } from './client';
const { supabase, getSupabase } = initializeSupabaseClient('native');
export { supabase, getSupabase };
