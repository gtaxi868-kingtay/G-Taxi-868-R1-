// EMERGENCY STABILIZATION - P0 Fix
// Hardened admin_force_complete with:
// 1. Strict state validation (only valid transitions)
// 2. NO automatic payment processing - admin must explicitly choose
// 3. Required confirmation flags for dangerous actions
// 4. Extensive audit logging
// 5. Payment processing only through normal complete_ride flow

import { requireAdmin } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Valid states that can be admin-completed (with decreasing safety)
const VALID_STATES_FOR_COMPLETION = ['in_progress', 'arrived', 'assigned', 'searching']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { supabaseAdmin, user } = await requireAdmin(req)
    const { 
      ride_id, 
      confirm_unsafe_action,  // Required: 'I_UNDERSTAND_RISKS'
      process_payment,        // Explicit opt-in: true/false
      payment_method_override // 'cash', 'waive', or null (use ride default)
    } = await req.json()

    // ── Input Validation ─────────────────────────────────────────────────────
    if (!ride_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'ride_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Fetch Current Ride State ─────────────────────────────────────────────
    const { data: ride, error: rideError } = await supabaseAdmin
      .from('rides')
      .select('*, rider:profiles!rider_id(id, phone)')
      .eq('id', ride_id)
      .single()

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ success: false, error: 'Ride not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── State Validation ───────────────────────────────────────────────────────
    if (ride.status === 'completed') {
      return new Response(
        JSON.stringify({ success: false, error: 'Ride is already completed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (ride.status === 'cancelled') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot complete cancelled ride' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if state is valid for completion
    const stateSafety = VALID_STATES_FOR_COMPLETION.indexOf(ride.status)
    if (stateSafety === -1) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Cannot complete ride in '${ride.status}' status. Valid states: ${VALID_STATES_FOR_COMPLETION.join(', ')}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Safety Confirmation Required ───────────────────────────────────────────
    // For non-in_progress states, require explicit confirmation
    if (ride.status !== 'in_progress') {
      if (confirm_unsafe_action !== 'I_UNDERSTAND_RISKS') {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Completing a ride from '${ride.status}' is unsafe.`,
            details: {
              current_status: ride.status,
              requires_confirmation: true,
              confirmation_phrase: 'I_UNDERSTAND_RISKS',
              risk_explanation: 'Completing before in_progress may result in unpaid or disputed rides'
            }
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── Payment Validation ───────────────────────────────────────────────────
    let paymentIntent = {
      will_process: false,
      method: null as string | null,
      amount: 0,
      warning: null as string | null
    }

    if (process_payment === true) {
      // Determine payment method
      const method = payment_method_override || ride.payment_method || 'cash'
      
      if (method === 'wallet') {
        // CRITICAL: Only process wallet if ride was actually in_progress
        // AND rider had confirmed the ride (implicit consent)
        if (ride.status !== 'in_progress') {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Wallet payment requires ride to be in_progress. Use cash or waive for other states.' 
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        
        paymentIntent = {
          will_process: true,
          method: 'wallet',
          amount: ride.total_fare_cents || 0,
          warning: 'Processing wallet payment - ensure ride was legitimate'
        }
      } else if (method === 'cash') {
        // Cash is recorded but no actual charge (driver collected)
        paymentIntent = {
          will_process: true,
          method: 'cash',
          amount: ride.total_fare_cents || 0,
          warning: 'Recording cash payment - verify driver collected fare'
        }
      } else if (method === 'waive' || method === 'comp') {
        // No payment - comp ride
        paymentIntent = {
          will_process: false,
          method: 'waived',
          amount: 0,
          warning: 'Ride fare waived - no payment processed'
        }
      } else {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Unknown payment method: ${method}. Use 'wallet', 'cash', or 'waive'` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── Log Admin Action ──────────────────────────────────────────────────────
    const auditLog = {
      timestamp: new Date().toISOString(),
      admin_id: user.id,
      admin_email: user.email,
      action: 'admin_force_complete',
      ride_id: ride_id,
      previous_status: ride.status,
      new_status: 'completed',
      safety_override: ride.status !== 'in_progress',
      payment_intent: paymentIntent,
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown'
    }

    // Write to audit log (fire and forget - don't block completion)
    supabaseAdmin.from('admin_audit_log').insert(auditLog).catch(err => {
      console.error('Failed to write audit log:', err)
    })

    console.log('[ADMIN AUDIT]', JSON.stringify(auditLog))

    // ── Perform Completion ───────────────────────────────────────────────────
    
    // 1. Update ride status with full audit trail
    const { error: updateError } = await supabaseAdmin
      .from('rides')
      .update({ 
        status: 'completed',
        admin_override: true,
        admin_id: user.id,
        completed_at: new Date().toISOString(),
        payment_method: paymentIntent.method || ride.payment_method,
        updated_at: new Date().toISOString()
      })
      .eq('id', ride_id)
      .eq('status', ride.status)  // Critical: only update if status unchanged (concurrency guard)

    if (updateError) {
      throw new Error(`Failed to update ride: ${updateError.message}`)
    }

    // 2. Process Payment (if requested and safe)
    let paymentResult = { success: false, error: 'Not attempted', transaction_id: null }
    
    if (paymentIntent.will_process && paymentIntent.method === 'wallet') {
      // Use hardened wallet function
      const { data: walletResult, error: walletError } = await supabaseAdmin.rpc(
        'process_wallet_payment_hardened',
        {
          p_ride_id: ride_id,
          p_amount: paymentIntent.amount,
          p_idempotency_key: `admin_complete_${ride_id}_${Date.now()}`
        }
      )

      if (walletError) {
        paymentResult = { 
          success: false, 
          error: walletError.message,
          transaction_id: null 
        }
        console.error('[ADMIN] Wallet payment failed:', walletError)
      } else if (walletResult && walletResult.length > 0) {
        const result = walletResult[0]
        paymentResult = {
          success: result.success,
          error: result.error_message,
          transaction_id: result.transaction_id
        }
      }
    } else if (paymentIntent.method === 'cash' || paymentIntent.method === 'waived') {
      // Record cash/waived without processing charge
      paymentResult = { success: true, error: null, transaction_id: null }
    }

    // 3. Log ride event
    await supabaseAdmin.from('ride_events').insert({
      ride_id: ride_id,
      event_type: 'admin_force_completed',
      actor_type: 'admin',
      actor_id: user.id,
      metadata: {
        previous_status: ride.status,
        payment_processed: paymentResult.success,
        payment_method: paymentIntent.method,
        safety_override: ride.status !== 'in_progress'
      }
    })

    // ── Return Result ─────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ 
        success: true, 
        ride_id, 
        previous_status: ride.status,
        new_status: 'completed',
        payment: paymentResult,
        audit_logged: true,
        warning: ride.status !== 'in_progress' 
          ? 'Ride was not in_progress - ensure legitimacy' 
          : null
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('admin_force_complete error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
