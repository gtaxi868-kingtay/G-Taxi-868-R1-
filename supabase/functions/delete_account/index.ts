// Supabase Edge Function: delete_account
//
// WHAT THIS USED TO DO, AND WHY IT WAS REPLACED
// ---------------------------------------------
// This function used the service role to hard-delete the caller's row from
// auth.users. 46 foreign keys pointing at auth.users are ON DELETE NO ACTION
// (rides, wallet_transactions, saved_places, ride_messages, sos_events,
// support_tickets, package_reservations, passenger_details, ...), so the delete
// raised a foreign-key violation for anybody who had ever used the app. Proven
// live 2026-09-11 in a rolled-back transaction against a user with dependent
// rows:
//
//   ERROR: update or delete on table "users" violates foreign key constraint
//          "saved_places_user_id_fkey" on table "saved_places"
//   DETAIL: Key (id)=(...) is still referenced from table "saved_places".
//
// The old comment in this file claimed those FKs were ON DELETE CASCADE. They
// are not, and cascading them would be the wrong fix anyway: wallet_transactions
// is the platform's financial source of truth (CLAUDE.md rule 10) and must
// survive a deletion request.
//
// WHAT IT DOES NOW
// ----------------
// It files a deletion request through the flow that already existed in the
// database: request_account_deletion() sets a 30-day grace period (read from
// data_retention_policy.account_anonymisation), the nightly cron job
// `data-retention-purge` (03:15 UTC -> purge_expired_personal_data(false)) runs
// anonymise_user() once the grace period is up, and cancel_account_deletion()
// backs out of it.
//
// The apps now call those RPCs directly (packages/core/src/accountDeletion.ts).
// This endpoint is kept, and repointed, so that any caller that still hits the
// old slug does the safe thing instead of erroring — and so the destructive
// purge endpoint no longer exists on the project. The project is at the
// 100-edge-function cap, so this is a repoint of an existing slug, not a new
// function.
//
// No service role client here on purpose: request_account_deletion() is
// SECURITY DEFINER, granted to `authenticated`, and resolves the caller from
// auth.uid(). Identity comes from the JWT, never from the request body
// (CLAUDE.md rule 2). verify_jwt stays true.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader?.replace("Bearer ", ""),
    );
    if (authError || !user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    // "cancel" lets a caller back out of a pending request through the same slug.
    let action = "request";
    try {
      const body = await req.json();
      if (body && typeof body.action === "string") action = body.action;
    } catch {
      // No body is fine — default is to file the request.
    }

    if (action === "cancel") {
      const { data, error } = await supabaseClient.rpc("cancel_account_deletion");
      if (error) return json({ success: false, error: error.message }, 400);
      return json(data, 200);
    }

    const { data, error } = await supabaseClient.rpc("request_account_deletion");
    if (error) return json({ success: false, error: error.message }, 400);

    console.log(`[account deletion] request filed for user ${user.id}`);
    return json(data, 200);
  } catch (error: any) {
    console.error("delete_account error:", error);
    return json({ success: false, error: error?.message ?? "unknown error" }, 400);
  }
});
