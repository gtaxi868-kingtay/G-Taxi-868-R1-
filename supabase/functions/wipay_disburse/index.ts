// supabase/functions/wipay_disburse/index.ts
// Initiate a WiPay bank disbursement for an approved driver payout.
// Called by admin_process_payout after wallet debit succeeds.
//
// WiPay Payout API (inferred from v1/gateway patterns):
//   POST https://wipayfinancial.com/v1/gateway/payout
//   Headers: Content-Type: application/json, Api-Key, Account-Number
//   Body: { account_holder, bank_name, account_number, amount, currency, order_id }
//   Response: { transaction_id, status, message }
//
// Secrets required: WIPAY_ACCOUNT_NUMBER, WIPAY_API_KEY, WIPAY_ENV
//   (shared with wipay_payment and create_wipay_payment)

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

interface DisburseInput {
  payout_request_id: string
  driver_id: string
  amount_cents: number
  bank_name: string
  account_holder: string
  account_number: string
  account_type?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, user } = await requireAdmin(req)
    const body: DisburseInput = await req.json()

    // ── Validation ────────────────────────────────────────────
    if (!body.payout_request_id || !body.driver_id) {
      return new Response(
        JSON.stringify({ error: 'payout_request_id and driver_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!body.amount_cents || body.amount_cents <= 0) {
      return new Response(
        JSON.stringify({ error: 'amount_cents must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!body.bank_name || !body.account_holder || !body.account_number) {
      return new Response(
        JSON.stringify({ error: 'bank_name, account_holder, and account_number are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!WIPAY_ACCOUNT_NUMBER || !WIPAY_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'WiPay disbursement not configured',
          hint: 'Set WIPAY_ACCOUNT_NUMBER and WIPAY_API_KEY in Edge Function secrets',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Verify payout request exists and is approved ──────────
    const { data: payout, error: payoutErr } = await supabaseAdmin
      .from('payout_requests')
      .select('id, status, driver_id, amount_cents')
      .eq('id', body.payout_request_id)
      .single()

    if (payoutErr || !payout) {
      return new Response(
        JSON.stringify({ error: 'Payout request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (payout.status !== 'processing') {
      return new Response(
        JSON.stringify({ error: `Payout must be in 'processing' status, got '${payout.status}'` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Check for existing disbursement (idempotency) ────────────────────
    const { data: existing } = await supabaseAdmin
      .from('wipay_payouts')
      .select('id, status, wipay_transaction_id')
      .eq('payout_request_id', body.payout_request_id)
      .maybeSingle()

    if (existing && existing.status === 'completed') {
      return new Response(
        JSON.stringify({ success: true, wipay_payout_id: existing.id, status: 'already_completed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Build idempotency key ─────────────────────────────────
    const idempotencyKey = `wipay_disburse_${body.payout_request_id}_${body.driver_id}`
    const orderId = `payout_${body.payout_request_id.slice(0, 8)}_${Date.now()}`

    // ── Create local record ───────────────────────────────────
    const { data: wipayRecord, error: insertErr } = await supabaseAdmin
      .from('wipay_payouts')
      .insert({
        payout_request_id: body.payout_request_id,
        driver_id: body.driver_id,
        amount_cents: body.amount_cents,
        bank_name: body.bank_name,
        account_holder: body.account_holder,
        account_number: body.account_number,
        account_type: body.account_type || 'savings',
        idempotency_key: idempotencyKey,
        wipay_reference: orderId,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insertErr) {
      // Duplicate idempotency_key → already submitted
      if (insertErr.message?.includes('duplicate key')) {
        return new Response(
          JSON.stringify({ error: 'Disbursement already initiated for this payout' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      throw insertErr
    }

    const wipayPayoutId = wipayRecord.id

    // ── Call WiPay Disbursement API ───────────────────────────
    const wipayPayload = {
      account_holder: body.account_holder,
      bank_name: body.bank_name,
      account_number: body.account_number,
      amount: (body.amount_cents / 100).toFixed(2),
      currency: 'TTD',
      order_id: orderId,
      description: `G-Taxi driver payout — ${body.driver_id.slice(0, 8)}`,
    }

    let wipayResponse: Response
    try {
      wipayResponse = await fetch(`${WIPAY_BASE_URL}/payout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': WIPAY_API_KEY,
          'Account-Number': WIPAY_ACCOUNT_NUMBER,
        },
        body: JSON.stringify(wipayPayload),
      })
    } catch (fetchErr) {
      // Network error — mark for retry
      await supabaseAdmin
        .from('wipay_payouts')
        .update({ status: 'pending', raw_response: JSON.stringify({ error: 'Network error: ' + (fetchErr as Error).message }) })
        .eq('id', wipayPayoutId)

      return new Response(
        JSON.stringify({ error: 'Failed to reach WiPay API. Payout queued for retry.', wipay_payout_id: wipayPayoutId }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const wipayResult = await wipayResponse.json()

    if (!wipayResponse.ok) {
      // WiPay rejected — mark failed
      await supabaseAdmin
        .from('wipay_payouts')
        .update({
          status: 'failed',
          raw_response: JSON.stringify(wipayResult),
          failed_at: new Date().toISOString(),
        })
        .eq('id', wipayPayoutId)

      return new Response(
        JSON.stringify({
          error: 'WiPay rejected disbursement',
          wipay_error: wipayResult.message || wipayResult.error || 'Unknown',
          wipay_payout_id: wipayPayoutId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Success — mark submitted, record transaction ID ────────
    await supabaseAdmin
      .from('wipay_payouts')
      .update({
        status: 'submitted',
        wipay_transaction_id: wipayResult.transaction_id || null,
        raw_response: JSON.stringify(wipayResult),
        submitted_at: new Date().toISOString(),
      })
      .eq('id', wipayPayoutId)

    return new Response(
      JSON.stringify({
        success: true,
        wipay_payout_id: wipayPayoutId,
        wipay_transaction_id: wipayResult.transaction_id || null,
        status: 'submitted',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    if (err instanceof Response) return err
    console.error('wipay_disburse error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
