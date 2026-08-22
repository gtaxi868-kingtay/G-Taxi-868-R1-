// Consolidates create_split_session / join_split_session / confirm_split_payment
// into one action-dispatch entrypoint (same pattern as admin/commander_gateway).
//
// The three originals had two real race conditions: join_split_session checked
// "session not full" then inserted as two unguarded statements (TOCTOU overfill),
// and confirm_split_payment read wallet balance then inserted a debit as two
// unguarded statements — exactly the pattern CLAUDE.md rule #4 prohibits, and it
// never skipped already-charged participants so a retry would double-bill them.
// Both races are now closed inside split_session_join_atomic and
// split_session_confirm_atomic (SELECT FOR UPDATE on the session row for the
// whole check-then-write unit), verified end-to-end in a rolled-back transaction
// before this went live — see 20260821010000_split_payment_atomic_rpcs.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(
      authHeader?.replace("Bearer ", "") ?? ""
    );
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    switch (action) {
      case "create": {
        const { total_cents, participant_count, title, ride_id } = body;

        if (!total_cents || total_cents <= 0) {
          return json({ success: false, error: "Invalid total_cents" }, 400);
        }
        if (!participant_count || participant_count < 2 || participant_count > 20) {
          return json({ success: false, error: "participant_count must be 2-20" }, 400);
        }

        const share_cents = Math.floor(total_cents / participant_count);

        const { data: session, error: insertErr } = await supabaseAdmin
          .from("split_sessions")
          .insert({
            creator_id: user.id,
            ride_id: ride_id || null,
            total_cents,
            participant_count,
            share_cents,
            title: title || "Group Ride",
            status: "collecting",
          })
          .select()
          .single();

        if (insertErr) {
          console.error("[split_payment_gateway/create] failed:", insertErr);
          return json({ success: false, error: "Failed to create session" }, 500);
        }

        return json({ success: true, data: session });
      }

      case "join": {
        const { session_id } = body;
        if (!session_id) return json({ success: false, error: "session_id required" }, 400);

        const { data, error } = await supabaseAdmin.rpc("split_session_join_atomic", {
          p_session_id: session_id,
          p_user_id: user.id,
        }).single();

        if (error) {
          console.error("[split_payment_gateway/join] RPC error:", error);
          return json({ success: false, error: "Failed to join session" }, 500);
        }

        const result = data as { success: boolean; error_message: string | null; participant_id: string | null };
        if (!result.success) {
          const status =
            result.error_message === "Session not found" ? 404 :
            result.error_message === "Session expired" ? 410 : 409;
          return json({ success: false, error: result.error_message }, status);
        }

        return json({ success: true, data: { id: result.participant_id, session_id, user_id: user.id } });
      }

      case "confirm": {
        const { session_id } = body;
        if (!session_id) return json({ success: false, error: "session_id required" }, 400);

        const { data, error } = await supabaseAdmin.rpc("split_session_confirm_atomic", {
          p_session_id: session_id,
          p_creator_id: user.id,
        }).single();

        if (error) {
          const msg = error.message || "";
          const status =
            msg.includes("Session not found") ? 404 :
            msg.includes("Only the creator") ? 403 :
            msg.includes("already") || msg.includes("Not all participants") || msg.includes("have not confirmed") ? 409 :
            500;
          return json({ success: false, error: msg || "Failed to confirm payment" }, status);
        }

        const result = data as { charged_count: number; failed_count: number; session_status: string };
        return json({
          success: true,
          data: {
            charged_count: result.charged_count,
            failed_count: result.failed_count,
            session_status: result.failed_count === 0 ? "confirmed" : "partial",
          },
        });
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("split_payment_gateway error:", err);
    return json({ success: false, error: "Internal error" }, 500);
  }
});
