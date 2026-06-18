import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-merchant-key',
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyMerchantKey(req: Request, requiredScope: string) {
  const rawKey = req.headers.get('x-merchant-key')
  if (!rawKey) throw new Error("Missing Merchant API Key")

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // Hash the incoming key and compare against stored hash
  const keyHash = await sha256Hex(rawKey);
  const { data: keyData, error } = await supabaseAdmin
    .from('merchant_api_keys')
    .select('merchant_id, scopes, is_active')
    .eq('key_hash', keyHash)
    .single()

  if (error || !keyData) throw new Error("Invalid Merchant API Key")
  if (!keyData.is_active) throw new Error("Merchant API Key deactivated")
  
  if (!keyData.scopes.includes(requiredScope) && !keyData.scopes.includes('admin')) {
    throw new Error(`Insufficient permissions. Required scope: ${requiredScope}`)
  }

  return { merchantId: keyData.merchant_id }
}
