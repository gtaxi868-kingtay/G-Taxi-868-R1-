import { requireAdmin } from '../_shared/auth.ts'
import { captureException } from '../_shared/sentry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function computeSettlement(grossCents: number, supabaseAdmin: any): Promise<{
  reserveCents: number; platformFeeCents: number; driverPayoutCents: number; platformRate: number
}> {
  const { data: platRateRow } = await supabaseAdmin
    .from('pricing_config')
    .select('value_cents')
    .eq('key', 'PLATFORM_RATE_CENTS')
    .maybeSingle()
    .catch(() => ({ data: null }))
  const platformRate = platRateRow ? (platRateRow.value_cents ?? 1500) / 10000 : 0.15

  const { data: reserveRateRow } = await supabaseAdmin
    .from('pricing_config')
    .select('value_cents')
    .eq('key', 'RESERVE_RATE_CENTS')
    .maybeSingle()
    .catch(() => ({ data: null }))
  const reserveRate = reserveRateRow ? (reserveRateRow.value_cents ?? 300) / 10000 : 0.03

  const platformFeeCents = Math.round(grossCents * platformRate)
  const reserveCents = Math.round(grossCents * reserveRate)
  const driverPayoutCents = grossCents - platformFeeCents - reserveCents
  return { reserveCents, platformFeeCents, driverPayoutCents, platformRate }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, user } = await requireAdmin(req)
    const body = await req.json()
    const { action } = body

    switch (action) {
      // ─── USER / RIDER MANAGEMENT ────────────────────────────────────────────

      case 'get_users': {
        const { data: profiles, error: pErr } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, email, role')
          .order('created_at', { ascending: false })
        if (pErr) throw pErr

        const { data: drivers } = await supabaseAdmin.from('drivers').select('user_id')
        const driverIds = new Set((drivers || []).map((d: any) => d.user_id))

        const { data: txs } = await supabaseAdmin.from('wallet_transactions').select('user_id, amount')
        const balances: Record<string, number> = {}
        txs?.forEach((tx: any) => {
          balances[tx.user_id] = (balances[tx.user_id] || 0) + tx.amount
        })

        const users = (profiles || []).map((p: any) => ({
          id: p.id,
          name: p.full_name || 'No Name',
          email: p.email || 'No Email',
          role: p.role || 'rider',
          is_driver: driverIds.has(p.id),
          balance_cents: balances[p.id] || 0,
        }))

        const lockedDrivers = users
          .filter((u: any) => u.is_driver && u.balance_cents <= -30000)
          .map((u: any) => ({ user_id: u.id, name: u.name, balance: u.balance_cents }))

        return json({ success: true, users, lockedDrivers })
      }

      case 'toggle_driver': {
        const { user_id, action: subAction } = body
        if (!user_id || !['authorize', 'revoke'].includes(subAction)) {
          return json({ error: 'user_id and action (authorize|revoke) required' }, 400)
        }
        if (subAction === 'authorize') {
          const { error } = await supabaseAdmin.from('drivers').upsert({
            id: user_id, status: 'active', is_verified: true, is_online: false,
            vehicle_type: 'standard', base_fare_cents: 500,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' })
          if (error) throw error
        } else {
          const { error } = await supabaseAdmin.from('drivers')
            .update({ status: 'suspended', is_verified: false, is_online: false })
            .eq('id', user_id)
          if (error) throw error
        }
        return json({ success: true, user_id, action: subAction })
      }

      case 'suspend_rider': {
        const { rider_id, suspend } = body
        if (!rider_id || suspend === undefined) {
          return json({ success: false, error: 'rider_id and suspend boolean required' }, 400)
        }
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ suspended: suspend })
          .eq('id', rider_id)
        if (error) throw error
        return json({ success: true, rider_id, suspended: suspend })
      }

      case 'toggle_role': {
        const { target_user_id, new_role } = body
        if (!target_user_id || !['admin', 'rider'].includes(new_role)) {
          return json({ error: 'target_user_id and new_role (admin|rider) required' }, 400)
        }
        if (target_user_id === user.id && new_role !== 'admin') {
          return json({ error: 'Cannot demote yourself' }, 400)
        }
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ role: new_role, is_admin: new_role === 'admin' })
          .eq('id', target_user_id)
        if (error) throw error
        return json({ success: true, user_id: target_user_id, role: new_role })
      }

      case 'create_merchant_user': {
        const { email, password, full_name } = body
        if (!email || !password || !full_name) {
          return json({ success: false, error: 'email, password, full_name required' }, 400)
        }
        const { data: authUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { full_name, role: 'merchant' },
        })
        if (createError) throw createError
        const { data: merchant, error: mErr } = await supabaseAdmin
          .from('merchants')
          .insert({ name: full_name, created_by: authUser.user.id })
          .select('id')
          .single()
        if (mErr) throw mErr
        const { error: pErr } = await supabaseAdmin
          .from('profiles')
          .upsert({ id: authUser.user.id, full_name, email, merchant_id: merchant.id, role: 'merchant' }, { onConflict: 'id' })
        if (pErr) throw pErr
        return json({ success: true, user_id: authUser.user.id, merchant_id: merchant.id, email })
      }

      // ─── RIDE MANAGEMENT ────────────────────────────────────────────────────

      case 'get_rides': {
        const { data, error } = await supabaseAdmin
          .from('rides')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) throw error
        return json({ success: true, data })
      }

      case 'cancel_ride': {
        const { ride_id, reason } = body
        if (!ride_id) throw new Error('ride_id is required')
        const CANCELLABLE_STATUSES = [
          'requested', 'searching', 'waiting_queue', 'expired',
          'assigned', 'arrived', 'scheduled',
        ]
        const { data: ride, error: rideError } = await supabaseAdmin
          .from('rides')
          .select('status, rider_id, driver_id')
          .eq('id', ride_id)
          .single()
        if (rideError || !ride) throw new Error('Ride not found')
        if (!CANCELLABLE_STATUSES.includes(ride.status)) {
          throw new Error(`Cannot cancel ride in '${ride.status}' status`)
        }
        await supabaseAdmin.from('rides')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason || 'Cancelled by admin' })
          .eq('id', ride_id)
          .in('status', CANCELLABLE_STATUSES)

        await supabaseAdmin.from('ride_events').insert({
          ride_id, event_type: 'cancelled', actor_type: 'admin', actor_id: user.id,
          metadata: { reason: reason || 'Cancelled by admin', previous_status: ride.status, admin_email: user.email },
        }).catch(() => {})

        await supabaseAdmin.rpc('log_admin_action', {
          p_admin_id: user.id, p_admin_email: user.email || null, p_action: 'admin_cancel_ride',
          p_ride_id: ride_id, p_previous_status: ride.status, p_new_status: 'cancelled',
          p_reason: reason || 'Cancelled by admin',
          p_metadata: { driver_id: ride.driver_id, rider_id: ride.rider_id },
        }).catch(() => {})

        return json({ success: true, ride_id, previous_status: ride.status, new_status: 'cancelled', reason: reason || null })
      }

      case 'assign_driver': {
        const { ride_id, driver_id } = body
        if (!ride_id || !driver_id) throw new Error('ride_id and driver_id are required')
        const { error } = await supabaseAdmin
          .from('rides')
          .update({ driver_id, status: 'assigned', admin_override: true, admin_id: user.id })
          .eq('id', ride_id)
          .eq('status', 'searching')
        if (error) throw error
        return json({ success: true, ride_id, driver_id })
      }

      case 'force_complete': {
        const { ride_id, confirm_unsafe_action, process_payment, payment_method_override } = body
        if (!ride_id) return json({ success: false, error: 'ride_id is required' }, 400)

        const { data: ride, error: rideError } = await supabaseAdmin
          .from('rides')
          .select('*, rider:profiles!rider_id(id, phone)')
          .eq('id', ride_id)
          .single()
        if (rideError || !ride) return json({ success: false, error: 'Ride not found' }, 404)
        if (ride.status === 'completed') return json({ success: false, error: 'Ride is already completed' }, 400)
        if (ride.status === 'cancelled') return json({ success: false, error: 'Cannot complete cancelled ride' }, 400)

        const VALID_STATES = ['in_progress', 'arrived']
        if (!VALID_STATES.includes(ride.status)) {
          return json({ success: false, error: `Cannot complete ride in '${ride.status}' status` }, 400)
        }

        if (ride.status !== 'in_progress' && confirm_unsafe_action !== 'I_UNDERSTAND_RISKS') {
          return json({
            success: false, error: `Completing ride from '${ride.status}' is unsafe.`,
            details: { current_status: ride.status, requires_confirmation: true, confirmation_phrase: 'I_UNDERSTAND_RISKS' },
          }, 400)
        }

        const grossCents = ride.total_fare_cents || 0
        const settlement = await computeSettlement(grossCents, supabaseAdmin)

        let paymentMethod = ride.payment_method || 'cash'
        let willProcess = false
        let paymentWarning: string | null = null

        if (process_payment === true) {
          paymentMethod = payment_method_override || ride.payment_method || 'cash'
          if (paymentMethod === 'wallet') {
            if (ride.status !== 'in_progress') {
              return json({ success: false, error: 'Wallet payment requires ride to be in_progress' }, 400)
            }
            willProcess = true
            paymentWarning = 'Processing wallet payment — reserve will be locked by RPC'
          } else if (paymentMethod === 'cash') {
            willProcess = true
            paymentWarning = 'Recording cash payment — reserve will be locked'
          } else if (['waive', 'comp'].includes(paymentMethod)) {
            paymentMethod = 'waived'
            paymentWarning = 'Ride fare waived — no reserve collected'
          } else {
            return json({ success: false, error: `Unknown payment method: ${paymentMethod}` }, 400)
          }
        }

        const auditLog = {
          timestamp: new Date().toISOString(), admin_id: user.id, admin_email: user.email,
          action: 'admin_force_complete', ride_id, previous_status: ride.status, new_status: 'completed',
          safety_override: ride.status !== 'in_progress',
          settlement: { gross_cents: grossCents, ...settlement },
          payment_intent: { will_process: willProcess, method: paymentMethod, amount: grossCents, warning: paymentWarning },
          ip_address: req.headers.get('x-forwarded-for') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        }
        supabaseAdmin.from('admin_audit_log').insert(auditLog).catch(() => {})

        const { error: updateError } = await supabaseAdmin
          .from('rides')
          .update({
            status: 'completed', admin_override: true, admin_id: user.id,
            completed_at: new Date().toISOString(), payment_method: paymentMethod,
            driver_payout_cents: settlement.driverPayoutCents,
            reserve_cents: settlement.reserveCents,
            platform_fee_cents: settlement.platformFeeCents,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ride_id)
          .eq('status', ride.status)
        if (updateError) throw new Error(`Failed to update ride: ${updateError.message}`)

        let paymentResult = { success: false, error: 'Not attempted' as string | null, transaction_id: null as string | null }
        if (willProcess && paymentMethod === 'wallet') {
          const { data: walletResult, error: walletError } = await supabaseAdmin.rpc(
            'process_wallet_payment_hardened',
            { p_ride_id: ride_id, p_amount: grossCents, p_idempotency_key: `admin_complete_${ride_id}` }
          )
          if (walletError) {
            paymentResult = { success: false, error: walletError.message, transaction_id: null }
          } else if (walletResult?.[0]) {
            paymentResult = { success: walletResult[0].success, error: walletResult[0].error_message, transaction_id: walletResult[0].transaction_id }
          }
        } else if (paymentMethod === 'cash' || paymentMethod === 'waived') {
          paymentResult = { success: true, error: null, transaction_id: null }
        }

        if (paymentMethod !== 'wallet' && settlement.reserveCents > 0) {
          await supabaseAdmin.from('capital_reserve_ledger').insert({
            ride_id, amount_cents: settlement.reserveCents, status: 'locked',
            notes: `Admin force-complete (${paymentMethod}) — reserve locked`,
          }).catch(() => {})
        }

        await supabaseAdmin.from('ride_events').insert({
          ride_id, event_type: 'admin_force_completed', actor_type: 'admin', actor_id: user.id,
          metadata: { previous_status: ride.status, payment_processed: paymentResult.success, payment_method: paymentMethod },
        })
        await supabaseAdmin.rpc('log_platform_revenue', {
          p_ride_id: ride_id, p_order_id: ride.order_id || null,
          p_merchant_id: ride.billed_to_merchant_id || ride.merchant_id || null,
          p_gross_cents: grossCents, p_payout_cents: settlement.driverPayoutCents,
          p_merchant_earnings_cents: 0, p_reserve_cents: settlement.reserveCents,
        }).catch(() => {})

        return json({
          success: true, ride_id, previous_status: ride.status, new_status: 'completed',
          settlement: { gross_cents: grossCents, ...settlement },
          payment: paymentResult, audit_logged: true,
        })
      }

      case 'refund': {
        const { ride_id, reason } = body
        if (!ride_id) throw new Error('ride_id is required')
        const { data: ride } = await supabaseAdmin
          .from('rides')
          .select('rider_id, driver_id, total_fare_cents, payment_status, payment_method')
          .eq('id', ride_id)
          .single()
        if (!ride || !ride.rider_id || !ride.total_fare_cents) throw new Error('Ride not found or fare invalid')
        if (ride.payment_status === 'refunded') throw new Error('Ride is already refunded')

        const { error: rpcError } = await supabaseAdmin.rpc('admin_wallet_adjust', {
          p_user_id: ride.rider_id, p_amount_cents: ride.total_fare_cents,
          p_reason: 'REFUND RIDE ' + ride_id + (reason ? ' - ' + reason : ''), p_admin_id: user.id,
        })
        if (rpcError) throw rpcError

        if (ride.driver_id && ride.payment_method !== 'cash') {
          const { data: d } = await supabaseAdmin.from('drivers').select('user_id').eq('id', ride.driver_id).maybeSingle()
          if (d?.user_id) {
            const { data: driverPayments } = await supabaseAdmin
              .from('wallet_transactions')
              .select('amount')
              .eq('ride_id', ride_id)
              .eq('transaction_type', 'driver_payout')
              .limit(1)
            if (driverPayments?.[0]) {
              const payoutAmount = Math.abs(driverPayments[0].amount)
              await supabaseAdmin.rpc('admin_wallet_adjust', {
                p_user_id: d.user_id, p_amount_cents: -payoutAmount,
                p_reason: 'CLAWBACK: driver payout reversed for refund of ride ' + ride_id, p_admin_id: user.id,
              }).catch(() => {})
            }
          }
        }

        await supabaseAdmin.from('capital_reserve_ledger')
          .update({ status: 'released', notes: `Released on refund by admin ${user.id}` })
          .eq('ride_id', ride_id).eq('status', 'locked').catch(() => {})

        const { error: updateError } = await supabaseAdmin
          .from('rides')
          .update({ payment_status: 'refunded', updated_at: new Date().toISOString() })
          .eq('id', ride_id)
        if (updateError) throw updateError
        return json({ success: true, ride_id, refunded_cents: ride.total_fare_cents })
      }

      // ─── FINANCIALS ─────────────────────────────────────────────────────────

      case 'get_revenue_logs': {
        const { data, error } = await supabaseAdmin
          .from('platform_revenue_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) throw error
        return json({ data })
      }

      case 'get_pending_deposits': {
        const { data: deposits, error } = await supabaseAdmin
          .from('manual_deposits')
          .select('*, profiles(full_name, email)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
        if (error) throw error
        const formatted = (deposits || []).map((d: any) => ({
          ...d,
          profiles: { name: d.profiles?.full_name || 'Pilot', email: d.profiles?.email },
        }))
        return json({ success: true, data: formatted })
      }

      case 'verify_deposit': {
        const { deposit_id, status, amount_cents } = body
        if (!deposit_id || !['approved', 'rejected'].includes(status)) {
          return json({ success: false, error: 'Invalid parameters' }, 400)
        }
        const updateData: any = { status, updated_at: new Date().toISOString() }
        if (amount_cents !== undefined) updateData.amount_cents = amount_cents
        const { data, error } = await supabaseAdmin
          .from('manual_deposits').update(updateData).eq('id', deposit_id).select().single()
        if (error) throw error
        return json({ success: true, data })
      }

      case 'process_payout': {
        const { request_id, action: payoutAction, reason } = body
        if (!request_id || !['approve', 'reject'].includes(payoutAction)) {
          return json({ error: 'request_id and action (approve|reject) required' }, 400)
        }
        const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('process_payout_request', {
          p_request_id: request_id, p_action: payoutAction, p_admin_id: user.id, p_reason: reason ?? null,
        })
        if (rpcErr) return json({ error: rpcErr.message }, 400)

        let wipayResult: Record<string, unknown> | null = null
        if (payoutAction === 'approve') {
          const WIPAY_ACCOUNT_NUMBER = Deno.env.get('WIPAY_ACCOUNT_NUMBER')
          const WIPAY_API_KEY = Deno.env.get('WIPAY_API_KEY')
          const WIPAY_ENV = Deno.env.get('WIPAY_ENV') || 'sandbox'
          const WIPAY_BASE_URL = WIPAY_ENV === 'sandbox'
            ? 'https://sandbox.wipayfinancial.com/v1/gateway' : 'https://wipayfinancial.com/v1/gateway'

          if (WIPAY_ACCOUNT_NUMBER && WIPAY_API_KEY) {
            const { data: payoutReq } = await supabaseAdmin
              .from('payout_requests').select('id, driver_id, amount_cents').eq('id', request_id).single().catch(() => ({ data: null }))
            if (payoutReq) {
              const { data: bankAccount } = await supabaseAdmin
                .from('bank_accounts').select('bank_name, account_holder_name, account_number, account_type')
                .eq('driver_id', payoutReq.driver_id).eq('is_default', true).maybeSingle().catch(() => ({ data: null }))
              if (bankAccount) {
                const orderId = `payout_${request_id.slice(0, 8)}_${Date.now()}`
                const { data: wpRecord } = await supabaseAdmin.from('wipay_payouts').insert({
                  payout_request_id: request_id, driver_id: payoutReq.driver_id,
                  amount_cents: payoutReq.amount_cents, bank_name: bankAccount.bank_name,
                  account_holder: bankAccount.account_holder_name, account_number: bankAccount.account_number,
                  account_type: bankAccount.account_type || 'savings',
                  idempotency_key: `wipay_disburse_${request_id}_${payoutReq.driver_id}`,
                  wipay_reference: orderId, status: 'pending',
                }).select('id').single().catch(() => ({ data: null }))
                if (wpRecord) {
                  try {
                    const wipayResp = await fetch(`${WIPAY_BASE_URL}/payout`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json', 'Api-Key': WIPAY_API_KEY, 'Account-Number': WIPAY_ACCOUNT_NUMBER },
                      body: JSON.stringify({
                        account_holder: bankAccount.account_holder_name, bank_name: bankAccount.bank_name,
                        account_number: bankAccount.account_number, amount: (payoutReq.amount_cents / 100).toFixed(2),
                        currency: 'TTD', order_id: orderId,
                        description: `G-Taxi driver payout — ${payoutReq.driver_id.slice(0, 8)}`,
                      }),
                    })
                    const wipayData = await wipayResp.json()
                    if (wipayResp.ok) {
                      await supabaseAdmin.from('wipay_payouts').update({
                        status: 'submitted', wipay_transaction_id: wipayData.transaction_id || null,
                        raw_response: JSON.stringify(wipayData), submitted_at: new Date().toISOString(),
                      }).eq('id', wpRecord.id)
                      wipayResult = { wipay_payout_id: wpRecord.id, status: 'submitted', wipay_transaction_id: wipayData.transaction_id }
                    } else {
                      await supabaseAdmin.from('wipay_payouts').update({
                        status: 'failed', raw_response: JSON.stringify(wipayData), failed_at: new Date().toISOString(),
                      }).eq('id', wpRecord.id)
                      wipayResult = { wipay_payout_id: wpRecord.id, status: 'failed', wipay_error: wipayData.message || wipayData.error }
                    }
                  } catch {
                    wipayResult = { wipay_payout_id: wpRecord.id, status: 'pending', error: 'Network error, will retry' }
                  }
                }
              }
            }
          }
        }
        return json({ success: true, request_id, action: payoutAction, wipay_disbursement: wipayResult })
      }

      case 'settle_debt': {
        const { user_id, amount_cents } = body
        if (!user_id || amount_cents === undefined) throw new Error('user_id and amount_cents required')
        if (amount_cents <= 0) throw new Error('amount_cents must be positive')
        const { data: balanceResult } = await supabaseAdmin.rpc('get_wallet_balance', { p_user_id: user_id })
        if (balanceResult) {
          const balance = typeof balanceResult === 'number' ? balanceResult : (balanceResult[0]?.balance ?? balanceResult.balance ?? 0)
          if (balance < amount_cents) throw new Error(`Insufficient balance`)
        }
        const { error } = await supabaseAdmin.from('wallet_transactions').insert({
          user_id, amount: -amount_cents, transaction_type: 'debt_settlement',
          description: `Admin Manual Debt Settlement — authorized by admin ${user.id}`,
          status: 'completed', metadata: { admin_id: user.id },
        })
        if (error) throw error
        return json({ success: true, user_id, amount_cents })
      }

      // ─── FEATURE FLAGS / CONFIG ────────────────────────────────────────────

      case 'get_flags': {
        const { data: flags, error: flagsError } = await supabaseAdmin
          .from('system_feature_flags').select('*').order('id')
        const { data: config, error: configError } = await supabaseAdmin
          .from('system_config').select('*')
        if (flagsError || configError) throw flagsError || configError
        return json({ success: true, data: flags, config })
      }

      case 'toggle_flag': {
        const { id, is_active } = body
        if (!id || is_active === undefined) throw new Error('id and is_active required')
        const { error } = await supabaseAdmin
          .from('system_feature_flags').update({ is_active: !is_active }).eq('id', id)
        if (error) throw error
        return json({ success: true, id, is_active: !is_active })
      }

      // ─── DRIVER APPROVAL ────────────────────────────────────────────────────

      case 'get_pending_drivers': {
        const { data: pendingDrivers, error: driversError } = await supabaseAdmin
          .from('profiles').select('id, name, email, phone, created_at, avatar_url')
          .eq('role', 'driver').order('created_at', { ascending: false })
        if (driversError) throw driversError
        const driverIds = pendingDrivers?.map((d: any) => d.id) || []
        const { data: verifiedDrivers } = await supabaseAdmin
          .from('drivers').select('id, is_verified, status, vehicle_plate, vehicle_make, vehicle_model')
          .in('id', driverIds.length > 0 ? driverIds : ['00000000-0000-0000-0000-000000000000'])
        const { data: documents } = await supabaseAdmin
          .from('driver_documents').select('driver_id, document_type, storage_path, uploaded_at, status')
          .in('driver_id', driverIds.length > 0 ? driverIds : ['00000000-0000-0000-0000-000000000000'])
        const verifiedMap = new Map(verifiedDrivers?.map((d: any) => [d.id, d]))
        const docsByDriver: Record<string, any[]> = {}
        documents?.forEach((doc: any) => {
          if (!docsByDriver[doc.driver_id]) docsByDriver[doc.driver_id] = []
          docsByDriver[doc.driver_id].push(doc)
        })
        const pending = pendingDrivers?.filter((p: any) => {
          const r = verifiedMap.get(p.id)
          return !r || r.is_verified === false || r.status === 'pending'
        }).map((p: any) => ({
          ...p, driver_record: verifiedMap.get(p.id) || null, documents: docsByDriver[p.id] || [],
          has_license: docsByDriver[p.id]?.some((d: any) => d.document_type === 'license') || false,
          has_insurance: docsByDriver[p.id]?.some((d: any) => d.document_type === 'insurance') || false,
          has_vehicle_photo: docsByDriver[p.id]?.some((d: any) => d.document_type === 'vehicle_photo') || false,
        })) || []
        return json({ pending, count: pending.length, summary: { with_license: pending.filter((d: any) => d.has_license).length, with_insurance: pending.filter((d: any) => d.has_insurance).length, with_vehicle_photo: pending.filter((d: any) => d.has_vehicle_photo).length } })
      }

      // ─── NODE / PUCK MANAGEMENT ─────────────────────────────────────────────

      case 'manage_nodes': {
        const { node, node_id } = body
        switch (body.action_type || 'list') {
          case 'list': {
            const { data, error } = await supabaseAdmin
              .from('kiosk_nodes').select('*, merchants(id, name, category)').order('created_at', { ascending: false })
            if (error) throw error
            return json({ success: true, nodes: data })
          }
          case 'upsert': {
            if (!node) return json({ success: false, error: 'node payload required' }, 400)
            if (node.id) {
              const { data, error } = await supabaseAdmin.from('kiosk_nodes').update(node).eq('id', node.id).select().single()
              if (error) throw error
              return json({ success: true, node: data })
            }
            const { data, error } = await supabaseAdmin.from('kiosk_nodes').insert({
              tag_uid: node.tag_uid, merchant_id: node.merchant_id || null,
              location_name: node.location_name, lat: node.lat || null, lng: node.lng || null,
              default_services: node.default_services || ['ride'], is_active: node.is_active ?? true,
            }).select().single()
            if (error) throw error
            return json({ success: true, node: data })
          }
          case 'toggle_active': {
            if (!node_id) return json({ success: false, error: 'node_id required' }, 400)
            const { data: current } = await supabaseAdmin.from('kiosk_nodes').select('is_active').eq('id', node_id).single()
            const { data, error } = await supabaseAdmin.from('kiosk_nodes').update({ is_active: !current?.is_active }).eq('id', node_id).select().single()
            if (error) throw error
            return json({ success: true, node: data })
          }
          case 'delete': {
            if (!node_id) return json({ success: false, error: 'node_id required' }, 400)
            const { error } = await supabaseAdmin.from('kiosk_nodes').delete().eq('id', node_id)
            if (error) throw error
            return json({ success: true })
          }
          default:
            return json({ success: false, error: `Unknown manage_nodes action_type: ${body.action_type}` }, 400)
        }
      }

      case 'manage_puck_inventory': {
        const VALID_LIFECYCLE = ['manufactured', 'assigned', 'activated', 'live', 'suspended', 'replaced']
        const { node, node_id } = body
        switch (body.action_type || 'list') {
          case 'list': {
            const { data, error } = await supabaseAdmin
              .from('kiosk_nodes').select('*, merchant:merchant_id(id, name, category), assigned_driver:assigned_to(id, full_name, email), territory:territory_id(id, name, code)')
              .order('created_at', { ascending: false })
            if (error) throw error
            return json({ success: true, nodes: data })
          }
          case 'register': {
            if (!node?.tag_uid || !node?.location_name) return json({ error: 'tag_uid and location_name required' }, 400)
            const { data, error } = await supabaseAdmin.from('kiosk_nodes').insert({
              tag_uid: node.tag_uid, merchant_id: node.merchant_id || null,
              location_name: node.location_name, lat: node.lat || null, lng: node.lng || null,
              default_services: node.default_services || ['ride'], lifecycle_status: 'manufactured',
              hardware_version: node.hardware_version || null, firmware_version: node.firmware_version || null,
              is_active: false, territory_id: node.territory_id || null,
            }).select().single()
            if (error) throw error
            return json({ success: true, node: data })
          }
          case 'assign': {
            if (!node_id || !node?.assigned_to) return json({ error: 'node_id and assigned_to required' }, 400)
            const { data, error } = await supabaseAdmin.from('kiosk_nodes').update({
              assigned_to: node.assigned_to, lifecycle_status: 'assigned',
            }).eq('id', node_id).select().single()
            if (error) throw error
            return json({ success: true, node: data })
          }
          case 'update': {
            if (!node?.id) return json({ error: 'node.id required' }, 400)
            const updateData: Record<string, unknown> = {}
            if (node.lifecycle_status !== undefined) {
              if (!VALID_LIFECYCLE.includes(node.lifecycle_status)) return json({ error: `Invalid lifecycle_status` }, 400)
              updateData.lifecycle_status = node.lifecycle_status
              if (['activated', 'live'].includes(node.lifecycle_status)) { updateData.commissioned_at = new Date().toISOString(); updateData.is_active = true }
              if (node.lifecycle_status === 'replaced') { updateData.decommissioned_at = new Date().toISOString(); updateData.is_active = false }
              if (node.lifecycle_status === 'suspended') updateData.is_active = false
            }
            if (node.hardware_version !== undefined) updateData.hardware_version = node.hardware_version
            if (node.firmware_version !== undefined) updateData.firmware_version = node.firmware_version
            if (node.battery_level !== undefined) updateData.battery_level = node.battery_level
            if (node.replaced_by !== undefined) updateData.replaced_by = node.replaced_by
            if (node.territory_id !== undefined) updateData.territory_id = node.territory_id
            if (node.merchant_id !== undefined) updateData.merchant_id = node.merchant_id
            if (node.location_name !== undefined) updateData.location_name = node.location_name
            if (node.lat !== undefined) updateData.lat = node.lat
            if (node.lng !== undefined) updateData.lng = node.lng
            const { data, error } = await supabaseAdmin.from('kiosk_nodes').update(updateData).eq('id', node.id).select().single()
            if (error) throw error
            return json({ success: true, node: data })
          }
          case 'delete': {
            if (!node_id) return json({ error: 'node_id required' }, 400)
            await supabaseAdmin.from('kiosk_nodes').delete().eq('id', node_id)
            return json({ success: true })
          }
          default:
            return json({ error: `Unknown manage_puck_inventory action_type: ${body.action_type}` }, 400)
        }
      }

      // ─── TERRITORY / COMMANDER MANAGEMENT ───────────────────────────────────

      case 'manage_territories': {
        const { territory: t } = body
        switch (body.action_type || 'list') {
          case 'list': {
            const { data, error } = await supabaseAdmin
              .from('territories').select('*, commander:commander_id(id, email, full_name)').order('name')
            if (error) throw error
            return json({ success: true, territories: data })
          }
          case 'create': {
            if (!t?.name || !t?.code) return json({ error: 'name and code required' }, 400)
            const { data, error } = await supabaseAdmin.from('territories').insert({
              name: t.name, code: t.code, region_id: t.region_id || null,
              boundary_geojson: t.boundary_geojson || null, commander_id: t.commander_id || null,
              is_active: t.is_active ?? true, metadata: t.metadata || {},
            }).select().single()
            if (error) throw error
            return json({ success: true, territory: data })
          }
          case 'update': {
            if (!t?.id) return json({ error: 'territory.id required' }, 400)
            const { data, error } = await supabaseAdmin.from('territories').update({
              name: t.name, code: t.code, region_id: t.region_id,
              boundary_geojson: t.boundary_geojson, commander_id: t.commander_id,
              is_active: t.is_active, metadata: t.metadata,
            }).eq('id', t.id).select().single()
            if (error) throw error
            return json({ success: true, territory: data })
          }
          case 'delete': {
            if (!t?.id) return json({ error: 'territory.id required' }, 400)
            await supabaseAdmin.from('territories').delete().eq('id', t.id)
            return json({ success: true })
          }
          default:
            return json({ error: `Unknown action_type: ${body.action_type}` }, 400)
        }
      }

      case 'manage_commanders': {
        const { user_id, territory_id, status: cmdStatus, application_id, notes } = body
        switch (body.action_type || 'list') {
          case 'list': {
            const { data, error } = await supabaseAdmin
              .from('pod_commanders').select('*, user:user_id(id, email, full_name, role), territory:territory_id(id, name, code)')
              .order('created_at', { ascending: false })
            if (error) throw error
            return json({ success: true, commanders: data })
          }
          case 'update_status': {
            if (!user_id || !cmdStatus) return json({ error: 'user_id and status required' }, 400)
            if (!['active', 'inactive', 'suspended', 'pending'].includes(cmdStatus)) return json({ error: 'Invalid status' }, 400)
            const { data, error } = await supabaseAdmin.from('pod_commanders').update({ status: cmdStatus }).eq('user_id', user_id).select().single()
            if (error) throw error
            return json({ success: true, commander: data })
          }
          case 'assign_territory': {
            if (!user_id || !territory_id) return json({ error: 'user_id and territory_id required' }, 400)
            const { data, error } = await supabaseAdmin.from('pod_commanders').update({ territory_id }).eq('user_id', user_id).select().single()
            if (error) throw error
            await supabaseAdmin.from('territories').update({ commander_id: user_id }).eq('id', territory_id)
            return json({ success: true, commander: data })
          }
          case 'list_applications': {
            const { data, error } = await supabaseAdmin
              .from('commander_applications').select('*, user:user_id(id, email, full_name, role)').order('created_at', { ascending: false })
            if (error) throw error
            return json({ success: true, applications: data })
          }
          case 'approve_application': {
            if (!application_id) return json({ error: 'application_id required' }, 400)
            const { data: app, error: appError } = await supabaseAdmin.from('commander_applications').select('*').eq('id', application_id).single()
            if (appError) throw appError
            if (app.status !== 'pending') return json({ error: `Application already ${app.status}` }, 409)
            await supabaseAdmin.from('profiles').update({ role: 'pod_commander' }).eq('id', app.user_id)
            const snapshot = { phone: app.phone, whatsapp: app.whatsapp, area: app.area, source_application_id: app.id, approved_at: new Date().toISOString() }
            const { data: commander } = await supabaseAdmin.from('pod_commanders').upsert({ user_id: app.user_id, status: 'active', metrics: snapshot }, { onConflict: 'user_id' }).select().single()
            await supabaseAdmin.from('commander_applications').update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: notes || null }).eq('id', application_id)
            return json({ success: true, commander })
          }
          case 'reject_application': {
            if (!application_id) return json({ error: 'application_id required' }, 400)
            const { data, error } = await supabaseAdmin.from('commander_applications').update({
              status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: notes || null,
            }).eq('id', application_id).eq('status', 'pending').select().single()
            if (error) throw error
            return json({ success: true, application: data })
          }
          default:
            return json({ error: `Unknown action_type: ${body.action_type}` }, 400)
        }
      }

      // ─── TRAVEL PACKAGE CRUD ────────────────────────────────────────────────

      case 'upsert_travel_package': {
        const { id: pkgId } = body
        const b = body
        if (b.action === 'delete') {
          if (!pkgId) return json({ error: 'id required for delete' }, 400)
          await supabaseAdmin.from('travel_packages').delete().eq('id', pkgId)
          return json({ success: true, action: 'deleted', id: pkgId })
        }

        if (b.price_per_person_cents !== undefined && b.wholesale_cost_cents !== undefined) {
          if (b.wholesale_cost_cents >= b.price_per_person_cents) {
            return json({ error: 'wholesale cost must be less than retail price', wholesale_cost_cents: b.wholesale_cost_cents, price_per_person_cents: b.price_per_person_cents }, 422)
          }
          const marginPct = ((b.price_per_person_cents - b.wholesale_cost_cents) / b.price_per_person_cents) * 100
          if (b.status === 'active' && marginPct < 10) {
            return json({ error: 'Cannot activate: margin must be at least 10%', margin_pct: Math.round(marginPct * 10) / 10 }, 422)
          }
        }

        let previousStatus: string | null = null
        if (pkgId) {
          const { data: existing } = await supabaseAdmin.from('travel_packages').select('status').eq('id', pkgId).single()
          previousStatus = existing?.status || null
        }

        const payload: Record<string, unknown> = {
          ...(b.title && { title: b.title }), ...(b.destination_code && { destination_code: b.destination_code }),
          ...(b.destination_name && { destination_name: b.destination_name }), ...(b.origin_code && { origin_code: b.origin_code }),
          ...(b.cover_image_url !== undefined && { cover_image_url: b.cover_image_url }),
          ...(b.property_id !== undefined && { property_id: b.property_id }),
          ...(b.flight_inventory_id !== undefined && { flight_inventory_id: b.flight_inventory_id }),
          ...(b.flight_info && Object.keys(b.flight_info).length && { flight_info: b.flight_info }),
          ...(b.hotel_info && Object.keys(b.hotel_info).length && { hotel_info: b.hotel_info }),
          ...(b.price_per_person_cents !== undefined && { price_per_person_cents: b.price_per_person_cents }),
          ...(b.wholesale_cost_cents !== undefined && { wholesale_cost_cents: b.wholesale_cost_cents }),
          ...(b.max_travelers && { max_travelers: b.max_travelers }),
          ...(b.includes_airport_transfer !== undefined && { includes_airport_transfer: b.includes_airport_transfer }),
          ...(b.status && { status: b.status }), ...(b.departure_at && { departure_at: b.departure_at }),
          ...(b.expires_at !== undefined && { expires_at: b.expires_at }),
          updated_at: new Date().toISOString(), ...(pkgId ? {} : { created_by: user.id }),
        }

        let resultId = pkgId
        if (pkgId) {
          const { data, error } = await supabaseAdmin.from('travel_packages').update(payload).eq('id', pkgId).select('*').single()
          if (error) throw error
          resultId = data.id
        } else {
          if (!b.title || !b.destination_code || !b.destination_name || !b.price_per_person_cents || !b.wholesale_cost_cents || !b.departure_at) {
            return json({ error: 'title, destination_code, destination_name, price_per_person_cents, wholesale_cost_cents, departure_at required' }, 400)
          }
          const { data, error } = await supabaseAdmin.from('travel_packages').insert({ ...payload, travelers_booked: 0 }).select('*').single()
          if (error) throw error
          resultId = data.id
        }

        let waitlistNotified = 0
        const justActivated = b.status === 'active' && previousStatus !== 'active'
        if (justActivated && b.destination_code) {
          const { data: waiters } = await supabaseAdmin.from('travel_waitlist').select('user_id').eq('destination_code', b.destination_code).is('notified_at', null)
          if (waiters?.length) {
            await Promise.allSettled(waiters.map(async (w: any) => {
              await supabaseAdmin.functions.invoke('send_push_notification', {
                body: { user_id: w.user_id, title: `New escape to ${b.destination_name || b.destination_code}!`, body: 'A Caribbean package just dropped. Seats are limited — grab yours now.', payload: { route: 'TravelStorefront', packageId: resultId } },
              }).catch(() => {})
            }))
            await supabaseAdmin.from('travel_waitlist').update({ notified_at: new Date().toISOString() }).eq('destination_code', b.destination_code).is('notified_at', null)
            waitlistNotified = waiters.length
          }
        }

        const { data: freshPkg } = await supabaseAdmin.from('travel_packages').select('*').eq('id', resultId).single()
        const marginCents = freshPkg ? freshPkg.price_per_person_cents - freshPkg.wholesale_cost_cents : 0
        const marginPct = freshPkg && freshPkg.price_per_person_cents > 0 ? Math.round((marginCents / freshPkg.price_per_person_cents) * 1000) / 10 : 0

        return json({
          success: true, package: { ...freshPkg, margin_cents_per_person: marginCents, margin_pct: marginPct, seats_remaining: freshPkg ? freshPkg.max_travelers - freshPkg.travelers_booked : 0 },
          waitlist_notified: waitlistNotified,
        })
      }

      // ─── ESCAPE SEATS (travel auto-refund/delay) ───────────────────────────

      case 'confirm_escape_seats': {
        const { package_id, action: escAction } = body
        if (!package_id || !escAction) return json({ error: 'package_id and action required' }, 400)
        const { departure_date, arrival_date, booking_reference } = body

        if (escAction === 'confirm') {
          const { data: participants } = await supabaseAdmin
            .from('escape_group_participants').select('id, rider_id, party_size, status, paid_cents')
            .eq('package_id', package_id).in('status', ['confirmed', 'payment_pending'])
          if (!participants?.length) return json({ error: 'No participants to confirm' }, 404)

          const { data: pkg, error: pkgErr } = await supabaseAdmin.from('escape_packages').update({
            allocated_guests: participants.reduce((s: number, p: any) => s + p.party_size, 0),
          }).eq('id', package_id).select('id, package_name, flight_block_id, lodging_node_id, price_per_person_cents').single()
          if (pkgErr) throw pkgErr

          for (const p of participants) {
            if (p.status === 'payment_pending') {
              await supabaseAdmin.from('escape_group_participants').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', p.id)
            }
            await supabaseAdmin.from('passenger_details').upsert({ participant_id: p.id, rider_id: p.rider_id, full_name: '', date_of_birth: '2000-01-01', nationality: 'TT' }, { onConflict: 'participant_id', ignoreDuplicates: true })
            await supabaseAdmin.from('escape_group_participants').update({ status: 'passport_pending' }).eq('id', p.id)
            await supabaseAdmin.rpc('notify_user', { p_user_id: p.rider_id, p_type: 'escape_confirmed', p_title: `Trip confirmed! ${pkg.package_name}`, p_body: 'Your trip is booked. Please submit your passport details.', p_data: { package_id, participant_id: p.id } }).catch(() => {})
          }

          if (booking_reference) {
            const { data: itineraries } = await supabaseAdmin.from('master_escape_itineraries').select('id').eq('package_id', package_id).limit(1)
            if (itineraries?.length) {
              await supabaseAdmin.from('itinerary_legs').insert(participants.map((p: any) => ({ master_itinerary_id: itineraries[0].id, leg_sequence: 1, service_type: 'flight', status: 'confirmed', reference_code: booking_reference, scheduled_start: departure_date || null, scheduled_end: arrival_date || null })))
            }
          }

          await supabaseAdmin.from('group_booking_alerts').insert({ package_id, alert_type: 'reschedule_accepted', message: `Admin confirmed ${participants.length} participants for ${pkg.package_name}. Ref: ${booking_reference || 'N/A'}` })
          return json({ success: true, participants_confirmed: participants.length, package: pkg.package_name, booking_reference: booking_reference || null })
        }

        if (escAction === 'delay') {
          const { message } = body
          await supabaseAdmin.from('group_booking_alerts').insert({ package_id, alert_type: 'delay', message: message || 'Trip delayed by admin' })
          const { data: participants } = await supabaseAdmin.from('escape_group_participants').select('rider_id').eq('package_id', package_id).in('status', ['confirmed', 'passport_pending', 'travel_ready'])
          if (participants) {
            for (const p of participants) {
              await supabaseAdmin.rpc('notify_user', { p_user_id: p.rider_id, p_type: 'escape_delay', p_title: 'Trip update', p_body: message || 'Your trip has been delayed.', p_data: { package_id } }).catch(() => {})
            }
          }
          return json({ success: true, notified: participants?.length || 0 })
        }

        if (escAction === 'refund_all') {
          const { data: participants } = await supabaseAdmin.from('escape_group_participants').select('id, rider_id, paid_cents').eq('package_id', package_id).in('status', ['confirmed', 'passport_pending', 'travel_ready'])
          let refunded = 0
          for (const p of participants || []) {
            if (p.paid_cents > 0) {
              const { error: refundErr } = await supabaseAdmin.rpc('credit_wallet', { p_user_id: p.rider_id, p_amount_cents: p.paid_cents, p_type: 'travel_package_refund', p_description: 'Full refund — trip cancelled by admin', p_reference_id: p.id })
              if (!refundErr) { await supabaseAdmin.from('escape_group_participants').update({ status: 'refunded' }).eq('id', p.id); refunded++ }
            } else { await supabaseAdmin.from('escape_group_participants').update({ status: 'cancelled' }).eq('id', p.id); refunded++ }
          }
          await supabaseAdmin.from('group_booking_alerts').insert({ package_id, alert_type: 'refund_completed', message: `Admin refunded ${refunded} participants` })
          return json({ success: true, refunded })
        }

        return json({ error: `Unknown action: ${escAction}. Use confirm, delay, or refund_all.` }, 400)
      }

      // ─── RIDER PROGRESSION ──────────────────────────────────────────────────

      case 'get_rider_progression': {
        const LEVEL_LABELS: Record<number, string> = { 1: 'New Rider', 2: 'Regular', 3: 'Power User', 4: 'Loyalist', 5: 'G-Escape' }
        const { data: progression, error: progError } = await supabaseAdmin
          .from('rider_progression').select('rider_id, level, total_rides, total_grocery_orders, total_laundry_orders, wallet_ever_funded, escape_ever_booked, unlocked_verticals, updated_at')
          .order('level', { ascending: false }).order('total_rides', { ascending: false })
        if (progError) return json({ error: progError.message }, 500)
        if (!progression?.length) return json({ data: [] })

        const riderIds = progression.map((p: any) => p.rider_id)
        const { data: profiles } = await supabaseAdmin.from('profiles').select('id, name, email').in('id', riderIds)
        const { data: configs } = await supabaseAdmin.from('progression_config').select('level, threshold_type, threshold_value, unlock_vertical, label').order('level')
        const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]))

        const enriched = progression.map((row: any) => {
          const profile = profileMap[row.rider_id] || {}
          const nextConfig = configs?.find((c: any) => c.level > row.level)
          let next_unlock = null
          if (nextConfig) {
            let progress = 0
            switch (nextConfig.threshold_type) {
              case 'rides': progress = row.total_rides; break
              case 'grocery_orders': progress = row.total_grocery_orders; break
              case 'laundry_orders': progress = row.total_laundry_orders; break
              case 'wallet_funded': progress = row.wallet_ever_funded ? 1 : 0; break
              case 'escape_booked': progress = row.escape_ever_booked ? 1 : 0; break
            }
            next_unlock = { vertical: nextConfig.unlock_vertical, progress, required: nextConfig.threshold_value, label: nextConfig.label || nextConfig.unlock_vertical }
          }
          return { rider_id: row.rider_id, name: profile.name || null, email: profile.email || null, level: row.level, level_label: LEVEL_LABELS[row.level] || `Level ${row.level}`, total_rides: row.total_rides, total_grocery_orders: row.total_grocery_orders, total_laundry_orders: row.total_laundry_orders, wallet_ever_funded: row.wallet_ever_funded, escape_ever_booked: row.escape_ever_booked, unlocked_verticals: row.unlocked_verticals || [], next_unlock }
        })
        return json({ data: enriched })
      }

      // ─── SURGE ZONES ────────────────────────────────────────────────────────

      case 'manage_surge_zones': {
        switch (body.action_type || 'list') {
          case 'list': {
            const { data, error } = await supabaseAdmin.from('pricing_zones').select('*').order('created_at', { ascending: false })
            if (error) return json({ error: error.message }, 500)
            return json({ zones: data })
          }
          case 'create':
          case 'update': {
            const { id, name, center_lat, center_lng, radius_meters = 2000, multiplier, expires_at, is_active = true, reason } = body
            if (!center_lat || !center_lng || !multiplier) return json({ error: 'center_lat, center_lng, multiplier required' }, 400)
            if (multiplier < 1.0 || multiplier > 5.0) return json({ error: 'multiplier must be between 1.0 and 5.0' }, 400)
            const payload = { name: name ?? `Surge ${new Date().toLocaleTimeString()}`, center_lat, center_lng, radius_meters, multiplier, expires_at: expires_at ?? null, is_active, reason: reason ?? null, created_by: user.id }
            let result
            if (body.action_type === 'update' && id) {
              const { data, error } = await supabaseAdmin.from('pricing_zones').update(payload).eq('id', id).select().single()
              if (error) return json({ error: error.message }, 500)
              result = data
            } else {
              const { data, error } = await supabaseAdmin.from('pricing_zones').insert(payload).select().single()
              if (error) return json({ error: error.message }, 500)
              result = data
            }
            return json({ zone: result })
          }
          case 'deactivate': {
            const { id } = body
            const { data, error } = await supabaseAdmin.from('pricing_zones').update({ is_active: false }).eq('id', id).select().single()
            if (error) return json({ error: error.message }, 500)
            return json({ zone: data })
          }
          case 'delete': {
            const { id } = body
            await supabaseAdmin.from('pricing_zones').delete().eq('id', id)
            return json({ deleted: id })
          }
          default:
            return json({ error: 'Unknown action_type' }, 400)
        }
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400)
    }

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('admin consolidated error:', err)
    await captureException(err, { function: 'admin' })
    return json({ success: false, error: err.message || 'Internal error' }, 500)
  }
})
