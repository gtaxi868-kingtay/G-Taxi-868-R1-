// Supabase Edge Function: admin_force_complete
// ============================================================
// CAPITAL RESERVE LOCK — Admin Force-Complete Path (2026-05-22)
// ============================================================
// Settlement math (server-side only):
//   reserve      = round(gross * 0.015)     → capital_reserve_ledger
//   net          = gross - reserve
//   platform_fee = round(net * 0.185)       → platform wallet credit
//   driver_payout = net - platform_fee       → driver wallet / waived
//
// Wallet payments route through process_wallet_payment_hardened
// (which now includes the 1.5% War Chest internally).
// Cash/waived paths insert capital_reserve_ledger explicitly here.
// ============================================================

import { requireAdmin } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VALID_STATES_FOR_COMPLETION = ['in_progress', 'arrived', 'assigned', 'searching']

/**
 * Server-side settlement calculation — single source of truth.
 * Must match the calculate_settlement() RPC exactly.
 */
function computeSettlement(grossCents: number): {
    reserveCents: number
    platformFeeCents: number
    driverPayoutCents: number
} {
    const reserveCents = Math.round(grossCents * 0.015)
    const net = grossCents - reserveCents
    const platformFeeCents = Math.round(net * 0.185)
    const driverPayoutCents = net - platformFeeCents
    return { reserveCents, platformFeeCents, driverPayoutCents }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { supabaseAdmin, user } = await requireAdmin(req)
        const {
            ride_id,
            confirm_unsafe_action,
            process_payment,
            payment_method_override
        } = await req.json()

        if (!ride_id) {
            return new Response(
                JSON.stringify({ success: false, error: 'ride_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

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

        // ── Compute settlement (server-side, no client trust) ──────────────
        const grossCents = ride.total_fare_cents || 0
        const { reserveCents, platformFeeCents, driverPayoutCents } = computeSettlement(grossCents)

        let paymentIntent = {
            will_process: false,
            method: null as string | null,
            amount: 0,
            warning: null as string | null
        }

        if (process_payment === true) {
            const method = payment_method_override || ride.payment_method || 'cash'

            if (method === 'wallet') {
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
                    amount: grossCents,
                    warning: 'Processing wallet payment — reserve will be locked by RPC'
                }
            } else if (method === 'cash') {
                paymentIntent = {
                    will_process: true,
                    method: 'cash',
                    amount: grossCents,
                    warning: 'Recording cash payment — reserve will be locked by admin_force_complete'
                }
            } else if (method === 'waive' || method === 'comp') {
                paymentIntent = {
                    will_process: false,
                    method: 'waived',
                    amount: 0,
                    warning: 'Ride fare waived — no reserve collected'
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

        // ── Log Admin Action ──────────────────────────────────────────────────
        const auditLog = {
            timestamp: new Date().toISOString(),
            admin_id: user.id,
            admin_email: user.email,
            action: 'admin_force_complete',
            ride_id: ride_id,
            previous_status: ride.status,
            new_status: 'completed',
            safety_override: ride.status !== 'in_progress',
            settlement: {
                gross_cents: grossCents,
                reserve_cents: reserveCents,
                platform_fee_cents: platformFeeCents,
                driver_payout_cents: driverPayoutCents,
            },
            payment_intent: paymentIntent,
            ip_address: req.headers.get('x-forwarded-for') || 'unknown',
            user_agent: req.headers.get('user-agent') || 'unknown'
        }

        supabaseAdmin.from('admin_audit_log').insert(auditLog).catch(err => {
            console.error('Failed to write audit log:', err)
        })

        console.log('[ADMIN AUDIT]', JSON.stringify(auditLog))

        // ── Perform Completion ──────────────────────────────────────────────────

        // 1. Update ride status with settlement breakdown
        const { error: updateError } = await supabaseAdmin
            .from('rides')
            .update({
                status: 'completed',
                admin_override: true,
                admin_id: user.id,
                completed_at: new Date().toISOString(),
                payment_method: paymentIntent.method || ride.payment_method,
                driver_payout_cents: driverPayoutCents,
                reserve_cents: reserveCents,
                platform_fee_cents: platformFeeCents,
                updated_at: new Date().toISOString()
            })
            .eq('id', ride_id)
            .eq('status', ride.status)

        if (updateError) {
            throw new Error(`Failed to update ride: ${updateError.message}`)
        }

        // 2. Process Payment (if requested)
        let paymentResult = { success: false, error: 'Not attempted', transaction_id: null as string | null }

        if (paymentIntent.will_process && paymentIntent.method === 'wallet') {
            // Wallet path: process_wallet_payment_hardened now handles
            // the 1.5% War Chest internally (see migration).
            const { data: walletResult, error: walletError } = await supabaseAdmin.rpc(
                'process_wallet_payment_hardened',
                {
                    p_ride_id: ride_id,
                    p_amount: paymentIntent.amount,
                    p_idempotency_key: `admin_complete_${ride_id}_${Date.now()}`
                }
            )

            if (walletError) {
                paymentResult = { success: false, error: walletError.message, transaction_id: null }
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
            // Cash/waived: no wallet charge, but reserve still applies
            paymentResult = { success: true, error: null, transaction_id: null }
        }

        // 3. Lock the War Chest (if not already done by RPC)
        //    Wallet path: RPC handles it. Cash/waived: we do it here.
        if (paymentIntent.method !== 'wallet' && reserveCents > 0) {
            await supabaseAdmin
                .from("capital_reserve_ledger")
                .insert({
                    ride_id: ride_id,
                    amount_cents: reserveCents,
                    status: "locked",
                    notes: `Admin force-complete (${paymentIntent.method}) — reserve locked`,
                })
                .catch((err: any) => console.error("[ADMIN] Failed to lock capital reserve:", err));
        }

        // 4. Log ride event
        await supabaseAdmin.from('ride_events').insert({
            ride_id: ride_id,
            event_type: 'admin_force_completed',
            actor_type: 'admin',
            actor_id: user.id,
            metadata: {
                previous_status: ride.status,
                payment_processed: paymentResult.success,
                payment_method: paymentIntent.method,
                safety_override: ride.status !== 'in_progress',
                settlement: {
                    gross_cents: grossCents,
                    reserve_cents: reserveCents,
                    platform_fee_cents: platformFeeCents,
                    driver_payout_cents: driverPayoutCents,
                },
            }
        })

        // 5. Log platform revenue
        await supabaseAdmin
            .rpc("log_platform_revenue", {
                p_ride_id: ride_id,
                p_order_id: ride.order_id || null,
                p_merchant_id: ride.billed_to_merchant_id || ride.merchant_id || null,
                p_gross_cents: grossCents,
                p_payout_cents: driverPayoutCents,
                p_merchant_earnings_cents: 0,
                p_reserve_cents: reserveCents,
            })
            .catch((err: any) => console.error("[ADMIN] Revenue logging failed:", err));

        return new Response(
            JSON.stringify({
                success: true,
                ride_id,
                previous_status: ride.status,
                new_status: 'completed',
                settlement: {
                    gross_cents: grossCents,
                    reserve_cents: reserveCents,
                    platform_fee_cents: platformFeeCents,
                    driver_payout_cents: driverPayoutCents,
                },
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
