import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-merchant-key',
}

export async function verifyMerchantKey(req: Request, requiredScope: string) {
  const apiKey = req.headers.get('x-merchant-key')
  if (!apiKey) throw new Error("Missing Merchant API Key")

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // In production, we would use a more sophisticated hash (Argon2/bcrypt)
  // For this implementation, we use a standard hash comparison
  const { data: keyData, error } = await supabaseAdmin
    .from('merchant_api_keys')
    .select('merchant_id, scopes, is_active')
    .eq('key_hash', apiKey) // Assuming the header contains the hash for simplicity here
    .single()

  if (error || !keyData) throw new Error("Invalid Merchant API Key")
  if (!keyData.is_active) throw new Error("Merchant API Key deactivated")
  
  if (!keyData.scopes.includes(requiredScope) && !keyData.scopes.includes('admin')) {
    throw new Error(`Insufficient permissions. Required scope: ${requiredScope}`)
  }

  return { merchantId: keyData.merchant_id }
}
