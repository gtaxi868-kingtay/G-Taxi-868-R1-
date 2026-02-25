import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Note: In a real admin console, you'd want to use a more secure auth flow
// But for this internal debug dashboard, we might use the service role key internally
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// Use regular client for subscriptions
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Use admin client for force actions
export const supabaseAdmin = createClient(supabaseUrl || '', supabaseServiceKey || supabaseAnonKey || '');
