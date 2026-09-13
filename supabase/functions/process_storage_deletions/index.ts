// Drains public.storage_deletion_queue.
//
// This is the ONLY component that deletes files. The database deliberately
// never touches storage: removing a row from storage.objects deletes the
// pointer and orphans the bytes, which is worse than doing nothing because
// nothing can find the file afterwards to clean it up. The storage API
// removes both, so the delete has to happen out here.
//
// Design notes that matter if you change this:
//   * Rows are claimed in small batches. A partial run is fine — whatever is
//     left stays 'pending' and the next run picks it up.
//   * A file that is already gone counts as SUCCESS, not failure. The goal is
//     "this file does not exist", and it already doesn't.
//   * After MAX_ATTEMPTS a row is parked as 'failed' with its last error, so a
//     permanently broken path cannot spin forever. It stays visible.
//   * Nothing here deletes driver-documents or driver_credentials — those are
//     7-year regulatory evidence and are never enqueued in the first place.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

// Belt and braces: even if something enqueues a protected bucket by mistake,
// this function refuses to act on it.
const NEVER_DELETE = new Set(["driver-documents", "driver_credentials"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Timing-safe string compare — a secret check that leaks its own answer
 *  through response time is not a check. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cron secret, or an admin's own JWT. Nothing else.
 *
 *  The expected secret is read from the DATABASE (Vault, via
 *  public.platform_cron_secret()) rather than only from an env var. That is
 *  the whole reason the nightly drain works: setting the Vault secret is a
 *  thing SQL can do, whereas setting a function's env var needs the
 *  dashboard. The env var is still honoured first so this function stays
 *  consistent with the other cron-called functions in this project, which
 *  compare against PLATFORM_CRON_SECRET directly.
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const cronHeader = req.headers.get("x-cron-secret");

  if (cronHeader) {
    if (CRON_SECRET && safeEqual(cronHeader, CRON_SECRET)) return true;

    try {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: expected } = await admin.rpc("platform_cron_secret");
      if (typeof expected === "string" && expected.length > 0 && safeEqual(cronHeader, expected)) {
        return true;
      }
    } catch (_) {
      // Fall through to JWT auth rather than failing open.
    }
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (error || !user) return false;

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAuthorized(req))) return json({ success: false, error: "Unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { data: rows, error: fetchError } = await supabase
      .from("storage_deletion_queue")
      .select("id, bucket_id, object_path, attempts")
      .eq("status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("requested_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) return json({ success: false, error: fetchError.message }, 500);
    if (!rows || rows.length === 0) return json({ success: true, processed: 0, remaining: 0 });

    // Group by bucket: storage.remove() takes a list of paths per bucket, so
    // one call per bucket instead of one per file.
    const byBucket = new Map<string, typeof rows>();
    for (const row of rows) {
      if (NEVER_DELETE.has(row.bucket_id)) {
        await supabase.from("storage_deletion_queue")
          .update({
            status: "skipped",
            last_error: "protected bucket — regulatory retention, never deleted",
            completed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        continue;
      }
      const list = byBucket.get(row.bucket_id) ?? [];
      list.push(row);
      byBucket.set(row.bucket_id, list);
    }

    let deleted = 0;
    let failed = 0;

    for (const [bucket, items] of byBucket) {
      const paths = items.map((i) => i.object_path);
      const ids = items.map((i) => i.id);

      const { error: removeError } = await supabase.storage.from(bucket).remove(paths);

      if (removeError) {
        // "not found" means the file is already gone, which IS the goal.
        const alreadyGone = /not.?found|does not exist/i.test(removeError.message ?? "");

        if (alreadyGone) {
          await supabase.from("storage_deletion_queue")
            .update({ status: "done", completed_at: new Date().toISOString() })
            .in("id", ids);
          deleted += ids.length;
          continue;
        }

        // Bump attempts individually so a row that keeps failing eventually
        // parks itself instead of being retried forever.
        for (const item of items) {
          const next = (item.attempts ?? 0) + 1;
          await supabase.from("storage_deletion_queue")
            .update({
              attempts: next,
              last_error: removeError.message,
              status: next >= MAX_ATTEMPTS ? "failed" : "pending",
            })
            .eq("id", item.id);
        }
        failed += ids.length;
        continue;
      }

      await supabase.from("storage_deletion_queue")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .in("id", ids);
      deleted += ids.length;
    }

    const { count: remaining } = await supabase
      .from("storage_deletion_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return json({ success: true, deleted, failed, remaining: remaining ?? 0 });
  } catch (err) {
    console.error("process_storage_deletions error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
});
