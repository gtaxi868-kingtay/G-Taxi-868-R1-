// supabase/functions/process_revshare_payouts/index.ts
// Batch process pending revshare payouts for bands and event organizers.
// Cron-callable (no auth required) OR called by admin UI with admin JWT.
// When called by cron: processes ALL pending records.
// When called by admin: accepts optional ledger_type + organizer_id for targeted payout.
// After marking records paid, attempts WiPay bank disbursement.

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
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const wipayConfigured = WIPAY_ACCOUNT_NUMBER && WIPAY_API_KEY

async function disburseToOrganizer(
  supabaseAdmin: any,
  payoutId: string,
  organizerId: string,
  ledgerType: string,
  organizerName: string,
  totalCents: number,
): Promise<Record<string, unknown>> {
  if (!wipayConfigured) {
    await supabaseAdmin.rpc('admin_update_revshare_wipay_status', {
      p_payout_id: payoutId,
      p_wipay_status: 'pending',
      p_wipay_error: 'WiPay not configured — secrets missing',
    })
    return { status: 'pending', note: 'WiPay secrets not set' }
  }

  // Look up default bank account
  const { data: bankAccount } = await supabaseAdmin
    .from('organizer_bank_accounts')
    .select('bank_name, account_holder_name, account_number, account_type')
    .eq('organizer_id', organizerId)
    .eq('ledger_type', ledgerType)
    .eq('is_default', true)
    .maybeSingle()
    .catch(() => ({ data: null }))

  if (!bankAccount) {
    await supabaseAdmin.rpc('admin_update_revshare_wipay_status', {
      p_payout_id: payoutId,
      p_wipay_status: 'pending',
      p_wipay_error: 'No default bank account for organizer',
    })
    return { status: 'pending', note: 'No bank account registered' }
  }

  const idempotencyKey = `wipay_revshare_${payoutId}`
  const orderId = `revshare_${payoutId.slice(0, 8)}_${Date.now()}`

  try {
    const wipayResp = await fetch(`${WIPAY_BASE_URL}/payout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': WIPAY_API_KEY!,
        'Account-Number': WIPAY_ACCOUNT_NUMBER!,
      },
      body: JSON.stringify({
        account_holder: bankAccount.account_holder_name,
        bank_name: bankAccount.bank_name,
        account_number: bankAccount.account_number,
        amount: (totalCents / 100).toFixed(2),
        currency: 'TTD',
        order_id: orderId,
        description: `G-Taxi revshare payout — ${organizerName}`,
      }),
    })

    const wipayData = await wipayResp.json()

    if (wipayResp.ok) {
      await supabaseAdmin.rpc('admin_update_revshare_wipay_status', {
        p_payout_id: payoutId,
        p_wipay_status: 'submitted',
        p_wipay_transaction_id: wipayData.transaction_id || null,
      })
      return { status: 'submitted', wipay_transaction_id: wipayData.transaction_id }
    } else {
      const errMsg = wipayData.message || wipayData.error || 'WiPay API error'
      await supabaseAdmin.rpc('admin_update_revshare_wipay_status', {
        p_payout_id: payoutId,
        p_wipay_status: 'failed',
        p_wipay_error: errMsg,
      })
      return { status: 'failed', error: errMsg }
    }
  } catch (fetchErr) {
    const errMsg = fetchErr instanceof Error ? fetchErr.message : 'Network error'
    await supabaseAdmin.rpc('admin_update_revshare_wipay_status', {
      p_payout_id: payoutId,
      p_wipay_status: 'failed',
      p_wipay_error: errMsg,
    })
    return { status: 'failed', error: errMsg }
  }
}

async function processOrganizer(
  supabaseAdmin: any,
  ledgerType: string,
  organizerId: string,
  adminUserId: string | null,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc('admin_process_revshare_payout', {
    p_ledger_type: ledgerType,
    p_organizer_id: organizerId,
    p_admin_id: adminUserId ?? null,
  })

  if (error) {
    return { ledger_type: ledgerType, organizer_id: organizerId, error: error.message }
  }
  if (!data?.success) {
    return { ledger_type: ledgerType, organizer_id: organizerId, error: data?.error ?? 'Unknown error' }
  }

  // WiPay disbursement
  const wipayResult = await disburseToOrganizer(
    supabaseAdmin,
    data.payout_id,
    organizerId,
    ledgerType,
    data.organizer_name,
    data.total_cents,
  )

  return { ...data, wipay: wipayResult }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const isCron = url.searchParams.has('cron')

  // ── GET: return pending revshare summaries + payout history ──
  if (req.method === 'GET') {
    if (!isCron) {
      try {
        await requireAdmin(req)
      } catch {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: bandSummary } = await supabaseAdmin
      .rpc('admin_get_pending_revshare', { p_ledger_type: 'band' })

    const { data: eventSummary } = await supabaseAdmin
      .rpc('admin_get_pending_revshare', { p_ledger_type: 'event' })

    const { data: payoutHistory } = await supabaseAdmin
      .rpc('admin_get_revshare_payout_history', { p_ledger_type: null, p_limit: 50 })

    return new Response(JSON.stringify({
      success: true,
      data: {
        pending_bands: bandSummary ?? [],
        pending_events: eventSummary ?? [],
        payout_history: payoutHistory ?? [],
      },
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── POST: process payouts ─────────────────────────────────────
  try {
    let adminUser: { id: string } | null = null
    let supabaseAdmin: any

    if (isCron) {
      supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    } else {
      const ctx = await requireAdmin(req)
      supabaseAdmin = ctx.supabaseAdmin
      adminUser = ctx.user
    }

    const body = await req.json().catch(() => ({}))
    const { ledger_type, organizer_id, retry_payout_id } = body

    const results: Array<Record<string, unknown>> = []
    const errors: Array<Record<string, unknown>> = []

    // ── Retry WiPay for a specific failed payout ────────────────
    if (retry_payout_id) {
      const { data: payout } = await supabaseAdmin
        .from('revshare_payouts')
        .select('*')
        .eq('id', retry_payout_id)
        .single()
        .catch(() => ({ data: null }))

      if (!payout) {
        return new Response(JSON.stringify({ error: 'Payout not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const wipayResult = await disburseToOrganizer(
        supabaseAdmin,
        payout.id,
        payout.organizer_id,
        payout.ledger_type,
        payout.organizer_name,
        payout.total_cents,
      )

      return new Response(JSON.stringify({
        success: wipayResult.status !== 'failed',
        payout_id: payout.id,
        wipay: wipayResult,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Targeted: one specific organizer ────────────────────────
    if (organizer_id && ledger_type) {
      const result = await processOrganizer(supabaseAdmin, ledger_type, organizer_id, adminUser?.id ?? null)
      if (result.error) {
        errors.push(result)
      } else {
        results.push(result)
      }
    } else if (ledger_type && !organizer_id) {
      // Batch: process all pending for a ledger type
      const { data: summary } = await supabaseAdmin
        .rpc('admin_get_pending_revshare', { p_ledger_type: ledger_type })

      for (const item of summary ?? []) {
        const result = await processOrganizer(supabaseAdmin, ledger_type, item.organizer_id, adminUser?.id ?? null)
        if (result.error) {
          errors.push(result)
        } else {
          results.push(result)
        }
      }
    } else {
      // No filters: process ALL pending (band + event)
      const { data: bandSummary } = await supabaseAdmin
        .rpc('admin_get_pending_revshare', { p_ledger_type: 'band' })

      const { data: eventSummary } = await supabaseAdmin
        .rpc('admin_get_pending_revshare', { p_ledger_type: 'event' })

      for (const item of [...(bandSummary ?? []), ...(eventSummary ?? [])]) {
        const result = await processOrganizer(supabaseAdmin, item.ledger_type, item.organizer_id, adminUser?.id ?? null)
        if (result.error) {
          errors.push(result)
        } else {
          results.push(result)
        }
      }
    }

    const totalCents = results.reduce((sum, r) => sum + (r.total_cents as number ?? 0), 0)

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_organizers_paid: results.length,
        total_errors: errors.length,
        total_cents_paid: totalCents,
        wipay_configured: wipayConfigured,
      },
      results,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('process_revshare_payouts error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
