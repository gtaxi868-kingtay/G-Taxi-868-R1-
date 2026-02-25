import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Use regular client for subscriptions
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Replace admin client with anon client
export const supabaseAdmin = createClient(supabaseUrl || '', supabaseAnonKey || '');
