// supabase/functions/admin_process_payout/index.ts
// Admin approves or rejects a driver payout request.
// Approval: atomically debits driver wallet, then initiates WiPay bank disbursement.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAdmin } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WIPAY_ACCOUNT_NUMBER = Deno.env.get('WIPAY_ACCOUNT_NUMBER')
const WIPAY_API_KEY = Deno.env.get('WIPAY_API_KEY')
const WIPAY_ENV = Deno.env.get('WIPAY_ENV') || 'sandbox'

const WIPAY_BASE_URL = WIPAY_ENV === 'sandbox'
  ? 'https://sandbox.wipayfinancial.com/v1/gateway'
  : 'https://wipayfinancial.com/v1/gateway'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, user } = await requireAdmin(req)
    const { request_id, action, reason } = await req.json()

    if (!request_id || !['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'request_id and action (approve|reject) are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 1: RPC — atomically debit wallet ────────────────
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('process_payout_request', {
      p_request_id: request_id,
      p_action: action,
      p_admin_id: user.id,
      p_reason: reason ?? null,
    })

    if (rpcErr) {
      console.error('process_payout_request error:', rpcErr)
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 2: If approved, initiate WiPay bank disbursement ──
    let wipayResult: Record<string, unknown> | null = null

    if (action === 'approve' && WIPAY_ACCOUNT_NUMBER && WIPAY_API_KEY) {
      // Fetch payout request + driver bank details
      const { data: payoutReq } = await supabaseAdmin
        .from('payout_requests')
        .select('id, driver_id, amount_cents')
        .eq('id', request_id)
        .single()
        .catch(() => ({ data: null }))

      if (payoutReq) {
        const { data: bankAccount } = await supabaseAdmin
          .from('bank_accounts')
          .select('bank_name, account_holder_name, account_number, account_type')
          .eq('driver_id', payoutReq.driver_id)
          .eq('is_default', true)
          .maybeSingle()
          .catch(() => ({ data: null }))

        if (bankAccount) {
          const idempotencyKey = `wipay_disburse_${request_id}_${payoutReq.driver_id}`
          const orderId = `payout_${request_id.slice(0, 8)}_${Date.now()}`

          // Record wipay_payout
          const { data: wpRecord } = await supabaseAdmin
            .from('wipay_payouts')
            .insert({
              payout_request_id: request_id,
              driver_id: payoutReq.driver_id,
              amount_cents: payoutReq.amount_cents,
              bank_name: bankAccount.bank_name,
              account_holder: bankAccount.account_holder_name,
              account_number: bankAccount.account_number,
              account_type: bankAccount.account_type || 'savings',
              idempotency_key: idempotencyKey,
              wipay_reference: orderId,
              status: 'pending',
            })
            .select('id')
            .single()
            .catch(() => ({ data: null }))

          if (wpRecord) {
            // Call WiPay disbursement API
            try {
              const wipayResp = await fetch(`${WIPAY_BASE_URL}/payout`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Api-Key': WIPAY_API_KEY,
                  'Account-Number': WIPAY_ACCOUNT_NUMBER,
                },
                body: JSON.stringify({
                  account_holder: bankAccount.account_holder_name,
                  bank_name: bankAccount.bank_name,
                  account_number: bankAccount.account_number,
                  amount: (payoutReq.amount_cents / 100).toFixed(2),
                  currency: 'TTD',
                  order_id: orderId,
                  description: `G-Taxi driver payout — ${payoutReq.driver_id.slice(0, 8)}`,
                }),
              })

              const wipayData = await wipayResp.json()

              if (wipayResp.ok) {
                await supabaseAdmin
                  .from('wipay_payouts')
                  .update({
                    status: 'submitted',
                    wipay_transaction_id: wipayData.transaction_id || null,
                    raw_response: JSON.stringify(wipayData),
                    submitted_at: new Date().toISOString(),
                  })
                  .eq('id', wpRecord.id)

                wipayResult = { wipay_payout_id: wpRecord.id, status: 'submitted', wipay_transaction_id: wipayData.transaction_id }
              } else {
                await supabaseAdmin
                  .from('wipay_payouts')
                  .update({
                    status: 'failed',
                    raw_response: JSON.stringify(wipayData),
                    failed_at: new Date().toISOString(),
                  })
                  .eq('id', wpRecord.id)

                wipayResult = { wipay_payout_id: wpRecord.id, status: 'failed', wipay_error: wipayData.message || wipayData.error }
              }
            } catch (fetchErr) {
              // Network error — leave as 'pending' for retry
              wipayResult = { wipay_payout_id: wpRecord.id, status: 'pending', error: 'Network error, will retry' }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      request_id,
      action,
      wipay_disbursement: wipayResult,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('admin_process_payout error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
