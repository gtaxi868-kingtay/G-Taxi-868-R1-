import { createClient } from '@supabase/supabase-js';
import { ENV } from '@gtaxi/core';

export const supabase = createClient(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || ENV.SUPABASE_URL,
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || ENV.SUPABASE_ANON_KEY
);
