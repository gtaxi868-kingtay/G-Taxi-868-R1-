import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const PLATFORM_CRON_SECRET = Deno.env.get("PLATFORM_CRON_SECRET") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendExpoPush(token: string | null, title: string, body: string, data: Record<string, unknown> = {}) {
    if (!token || !token.startsWith("ExponentPushToken[")) return;
    try {
        await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: token, title, body, data, sound: "default" }),
        });
    } catch (_) {}
}

async function activateScheduledTransfers(supabase: ReturnType<typeof createClient>) {
    const windowCutoff = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const { data: rides, error } = await supabase
        .from("rides")
        .select("id, rider_id")
        .eq("status", "scheduled")
        .lte("scheduled_for", windowCutoff);
    if (error || !rides?.length) return;
    if (rides.length > 5) {
        await supabase.from("system_alerts").insert({
            type: "RATE_LIMIT_BURST",
            title: "Anomaly Detected: activateScheduledTransfers",
            details: { message: `Attempted to activate ${rides.length} scheduled transfers at once.` },
            severity: "CRITICAL"
        }).catch(() => null);
        throw new Error("Circuit breaker tripped: activateScheduledTransfers exceeded 5 row safety limit.");
    }
    for (const ride of rides) {
        await supabase.from("rides").update({ status: "searching" }).eq("id", ride.id).eq("status", "scheduled");
        const { data: profile } = await supabase.from("profiles").select("push_token, name").eq("id", ride.rider_id).single();
        await sendExpoPush(profile?.push_token ?? null, "Your driver is being matched", "We're finding you a driver for your scheduled transfer.", { ride_id: ride.id, type: "transfer_searching" });
    }
}

async function sendTravelReminders(supabase: ReturnType<typeof createClient>) {
    const now = Date.now();
    const windows = [{ hours: 48, label: "48h" }, { hours: 24, label: "24h" }];
    for (const w of windows) {
        const windowStart = new Date(now + (w.hours - 1) * 60 * 60 * 1000).toISOString();
        const windowEnd = new Date(now + (w.hours + 1) * 60 * 60 * 1000).toISOString();
        const { data: bookings } = await supabase
            .from("travel_bookings")
            .select("id, user_id, package_id, travel_packages(title, departure_at)")
            .eq("status", "confirmed")
            .gte("travel_packages.departure_at", windowStart)
            .lte("travel_packages.departure_at", windowEnd);
        if (!bookings?.length) continue;
        for (const booking of bookings) {
            const sentinelKey = `travel_reminder_${booking.id}_${w.label}`;
            const { data: existing } = await supabase
                .from("agent_decision_log")
                .select("id")
                .eq("decision_type", "travel_reminder_sent")
                .contains("payload", { sentinel: sentinelKey })
                .maybeSingle();
            if (existing) continue;
            const { data: profile } = await supabase.from("profiles").select("push_token, name").eq("id", booking.user_id).single();
            const pkgTitle = (booking as any).travel_packages?.title ?? "your trip";
            await sendExpoPush(profile?.push_token ?? null, `${w.label} until departure`, `${pkgTitle} departs in ${w.hours} hours.`, { booking_id: booking.id, type: "travel_reminder" });
            await supabase.from("agent_decision_log").insert({ decision_type: "travel_reminder_sent", reasoning: `${w.label} reminder for booking ${booking.id}`, tool_used: "sendTravelReminders", payload: { sentinel: sentinelKey, booking_id: booking.id }, outcome: "push sent" });
        }
    }
}

async function sendMerchantOverdueWarnings(supabase: ReturnType<typeof createClient>) {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: subs } = await supabase
        .from("merchant_subscriptions")
        .select("id, merchant_id, overdue_since, merchants(name, created_by)")
        .eq("status", "overdue")
        .gte("overdue_since", fourDaysAgo)
        .lte("overdue_since", threeDaysAgo);
    if (!subs?.length) return;
    for (const sub of subs) {
        const merchantName = (sub as any).merchants?.name ?? "your store";
        const ownerId = (sub as any).merchants?.created_by;
        if (!ownerId) continue;
        const sentinelKey = `merchant_overdue_warning_${sub.merchant_id}`;
        const { data: existing } = await supabase.from("agent_decision_log").select("id").eq("decision_type", "merchant_overdue_warning").contains("payload", { sentinel: sentinelKey }).maybeSingle();
        if (existing) continue;
        const { data: profile } = await supabase.from("profiles").select("push_token").eq("id", ownerId).single();
        await sendExpoPush(profile?.push_token ?? null, "Your map pin disappears in 3 days", `${merchantName}: top up your G-Taxi wallet to stay visible.`, { merchant_id: sub.merchant_id, type: "merchant_overdue_warning" });
        await supabase.from("agent_decision_log").insert({ decision_type: "merchant_overdue_warning", reasoning: `Day-4 overdue warning for merchant ${sub.merchant_id}`, tool_used: "sendMerchantOverdueWarnings", payload: { sentinel: sentinelKey, merchant_id: sub.merchant_id }, outcome: "push sent" });
    }
}

async function checkRateExpiry(supabase: ReturnType<typeof createClient>) {
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expiring } = await supabase.from("travel_packages").select("id, title, rate_expiry_at, rate_contact").eq("status", "active").not("rate_expiry_at", "is", null).lte("rate_expiry_at", sevenDaysOut);
    if (!expiring?.length) return;
    for (const pkg of expiring) {
        const sentinelKey = `rate_expiry_alert_${pkg.id}`;
        const { data: existing } = await supabase.from("agent_decision_log").select("id").eq("decision_type", "rate_expiry_alert").contains("payload", { sentinel: sentinelKey }).maybeSingle();
        if (existing) continue;
        const daysLeft = Math.ceil((new Date(pkg.rate_expiry_at).getTime() - Date.now()) / 86400000);
        const label = daysLeft <= 0 ? "EXPIRED" : `expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
        const { data: admins } = await supabase.from("profiles").select("push_token").eq("role", "admin").not("push_token", "is", null);
        for (const admin of admins ?? []) {
            await sendExpoPush(admin.push_token, daysLeft <= 0 ? "Rate expired — package at risk" : "Rate renewal needed", `${pkg.title} — wholesale rate ${label}.${pkg.rate_contact ? ` Contact: ${pkg.rate_contact}` : ""}`, { package_id: pkg.id, type: "rate_expiry_alert" });
        }
        await supabase.from("agent_decision_log").insert({ decision_type: "rate_expiry_alert", reasoning: `Package "${pkg.title}" rate ${label}`, tool_used: "checkRateExpiry", payload: { sentinel: sentinelKey, package_id: pkg.id, rate_expiry_at: pkg.rate_expiry_at, days_left: daysLeft }, outcome: `Alert pushed to ${admins?.length ?? 0} admin(s)` });
    }
}

async function checkProgressionUnlocks(supabase: ReturnType<typeof createClient>) {
    const { data: configs } = await supabase.from("progression_config").select("level, threshold_type, threshold_value, unlock_vertical").order("level", { ascending: true });
    if (!configs?.length) return;
    const { data: riders } = await supabase.from("rider_progression").select("rider_id, level, total_rides, total_grocery_orders, total_laundry_orders, wallet_ever_funded, escape_ever_booked, unlocked_verticals").lt("level", 5);
    if (!riders?.length) return;
    for (const rider of riders) {
        const nextConfig = configs.find(c => c.level === rider.level + 1);
        if (!nextConfig) continue;
        let qualifies = false;
        switch (nextConfig.threshold_type) {
            case "total_rides": qualifies = (rider.total_rides ?? 0) >= (nextConfig.threshold_value ?? 999); break;
            case "total_grocery_orders": qualifies = (rider.total_grocery_orders ?? 0) >= (nextConfig.threshold_value ?? 999); break;
            case "total_laundry_orders": qualifies = (rider.total_laundry_orders ?? 0) >= (nextConfig.threshold_value ?? 999); break;
            case "wallet_funded": qualifies = rider.wallet_ever_funded === true; break;
            case "escape_booked": qualifies = rider.escape_ever_booked === true; break;
        }
        if (!qualifies) continue;
        if (rider.unlocked_verticals?.includes(nextConfig.unlock_vertical)) continue;
        const sentinelKey = `progression_unlock_${rider.rider_id}_${nextConfig.unlock_vertical}`;
        const { data: existing } = await supabase.from("agent_decision_log").select("id").eq("decision_type", "progression_unlock").contains("payload", { sentinel: sentinelKey }).maybeSingle();
        if (existing) continue;
        await supabase.from("rider_progression").update({ level: nextConfig.level, unlocked_verticals: [...(rider.unlocked_verticals || []), nextConfig.unlock_vertical], updated_at: new Date().toISOString() }).eq("rider_id", rider.rider_id);
        const { data: profile } = await supabase.from("profiles").select("push_token, name").eq("id", rider.rider_id).single();
        await sendExpoPush(profile?.push_token ?? null, "New feature unlocked", `${nextConfig.unlock_vertical.replace(/_/g, " ")} is now available.`, { type: "progression_unlock", vertical: nextConfig.unlock_vertical });
        await supabase.from("agent_decision_log").insert({ decision_type: "progression_unlock", reasoning: `Rider met threshold for ${nextConfig.unlock_vertical} (level ${nextConfig.level})`, tool_used: "checkProgressionUnlocks", payload: { sentinel: sentinelKey, rider_id: rider.rider_id, vertical: nextConfig.unlock_vertical }, outcome: `Unlocked ${nextConfig.unlock_vertical} for rider` });
    }
}

async function orchestrateLiquidity(supabase: ReturnType<typeof createClient>) {
    const { data: tasks } = await supabase
        .from("dispatch_queue")
        .select("id, task_type, order_id, ride_id, priority, pickup_lat, pickup_lng, attempts, created_at, expires_at")
        .eq("status", "pending")
        .lt("attempts", 3)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });
    if (!tasks?.length) return;
    const now = new Date();
    const expiredIds = tasks.filter(t => t.expires_at && new Date(t.expires_at) <= now).map(t => t.id);
    if (expiredIds.length > 0) {
        await supabase.from("dispatch_queue").update({ status: "expired" }).in("id", expiredIds).catch(() => null);
    }
    const active = tasks.filter(t => !t.expires_at || new Date(t.expires_at) > now);
    const assignmentPromises = active.map(async (task) => {
        if (!task.pickup_lat || !task.pickup_lng) {
            await supabase.from("dispatch_queue").update({ status: "failed", last_attempted: now.toISOString() }).eq("id", task.id);
            return;
        }
        const searchRadius = task.attempts === 0 ? 3000 : task.attempts === 1 ? 6000 : 10000;
        const { data: drivers } = await supabase.rpc("find_nearest_online_drivers", { p_lat: task.pickup_lat, p_lng: task.pickup_lng, p_radius_meters: searchRadius, p_limit: 1 }).catch(() => ({ data: [] }));
        if (!drivers?.length) {
            await supabase.from("dispatch_queue").update({ attempts: task.attempts + 1, last_attempted: now.toISOString() }).eq("id", task.id);
            return;
        }
        const driver = drivers[0];
        const taskLabel = task.task_type === "RIDE" ? "Ride request" : task.task_type === "GROCERY" ? "Grocery delivery" : task.task_type === "LAUNDRY" ? "Laundry pickup" : "Delivery task";
        await sendExpoPush(driver.push_token ?? null, `New ${taskLabel} available`, `Priority ${task.priority} ${task.task_type} — tap to accept.`, { task_id: task.id, task_type: task.task_type, ride_id: task.ride_id, order_id: task.order_id, type: "dispatch_task" });
        await supabase.from("dispatch_queue").update({ status: "assigned", driver_id: driver.driver_id, last_attempted: now.toISOString() }).eq("id", task.id);
        await supabase.from("agent_decision_log").insert({ decision_type: "dispatch_assigned", reasoning: `${task.task_type} task ${task.id} (priority ${task.priority}) assigned to driver ${driver.driver_id}`, tool_used: "orchestrateLiquidity", payload: { task_id: task.id, driver_id: driver.driver_id, task_type: task.task_type, priority: task.priority }, outcome: "driver soft-pinged" }).catch(() => null);
    });
    await Promise.allSettled(assignmentPromises);
}

const TOOLS = [
    { name: "get_demand_hotspots", description: "Returns geohash zones where demand/supply ratio >= threshold.", input_schema: { type: "object", properties: { min_score: { type: "number", description: "Minimum demand_score to include. Default 1.4." } }, required: [] } },
    { name: "get_order_dispatch_queue", description: "Returns pending orders needing a driver.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "get_package_opportunities", description: "Returns flight inventory with seats available.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "set_surge_multiplier", description: "Activates surge pricing for a zone.", input_schema: { type: "object", properties: { center_lat: { type: "number" }, center_lng: { type: "number" }, radius_meters: { type: "number" }, multiplier: { type: "number" }, reason: { type: "string" }, expires_minutes: { type: "number" } }, required: ["center_lat", "center_lng", "multiplier", "reason"] } },
    { name: "create_package_draft", description: "Creates a draft travel package from flight inventory.", input_schema: { type: "object", properties: { flight_inventory_id: { type: "string" }, title: { type: "string" }, destination_name: { type: "string" }, price_per_person_cents: { type: "number" }, reasoning: { type: "string" } }, required: ["flight_inventory_id", "title", "destination_name", "price_per_person_cents", "reasoning"] } },
    { name: "dispatch_pending_order", description: "Marks a queued order as dispatched.", input_schema: { type: "object", properties: { order_id: { type: "string" }, reasoning: { type: "string" } }, required: ["order_id", "reasoning"] } },
    { name: "log_no_action", description: "Logs that agent ran and found nothing requiring action.", input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
];

async function executeTool(toolName: string, input: Record<string, unknown>, supabase: ReturnType<typeof createClient>, runId: string): Promise<unknown> {
    switch (toolName) {
        case "get_demand_hotspots": {
            const minScore = (input.min_score as number) ?? 1.4;
            const { data, error } = await supabase.rpc("get_demand_hotspots", { p_min_score: minScore });
            if (error) return { error: error.message };
            return data ?? [];
        }
        case "get_order_dispatch_queue": {
            const { data, error } = await supabase.rpc("get_order_dispatch_queue");
            if (error) return { error: error.message };
            return data ?? [];
        }
        case "get_package_opportunities": {
            const { data, error } = await supabase.rpc("get_package_opportunities");
            if (error) return { error: error.message };
            return data ?? [];
        }
        case "set_surge_multiplier": {
            const { center_lat, center_lng, radius_meters, multiplier, reason, expires_minutes } = input as any;
            const expiresAt = new Date(Date.now() + ((expires_minutes ?? 30) * 60 * 1000)).toISOString();
            const radius = radius_meters ?? 2000;
            const { data: zoneId, error } = await supabase.rpc("admin_set_surge_zone", { p_lat: center_lat, p_lng: center_lng, p_radius_km: radius / 1000, p_multiplier: multiplier, p_expires_at: expiresAt });
            if (error) {
                const { data: inserted } = await supabase.from("pricing_zones").insert({ center_lat, center_lng, radius_meters: radius, multiplier, reason, expires_at: expiresAt, is_active: true }).select("id").single();
                if (!inserted) return { error: error.message };
                await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "surge_activated", reasoning: reason, tool_used: "set_surge_multiplier", payload: { center_lat, center_lng, multiplier, radius_meters: radius }, outcome: `Zone ${inserted.id} created` });
                return { success: true, zone_id: inserted.id };
            }
            await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "surge_activated", reasoning: reason, tool_used: "set_surge_multiplier", payload: { center_lat, center_lng, multiplier }, outcome: `Zone ${zoneId} activated` });
            return { success: true, zone_id: zoneId };
        }
        case "create_package_draft": {
            const { flight_inventory_id, title, destination_name, price_per_person_cents, reasoning } = input as any;
            const { data: flight } = await supabase.from("flight_inventory").select("destination_code, departure_at, wholesale_price_cents, retail_price_cents").eq("id", flight_inventory_id).single();
            if (!flight) return { error: "Flight not found" };
            const { data: pkg, error } = await supabase.from("travel_packages").insert({ title, destination_code: flight.destination_code, destination_name, flight_inventory_id, price_per_person_cents, wholesale_cost_cents: flight.wholesale_price_cents, max_travelers: 20, status: "draft", auto_generated: true, departure_at: flight.departure_at, flight_info: { source: "auto_generated" }, hotel_info: {} }).select("id").single();
            if (error) return { error: error.message };
            await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "package_created", reasoning, tool_used: "create_package_draft", payload: { package_id: pkg?.id, flight_inventory_id, title }, outcome: `Draft package ${pkg?.id} created for admin review` });
            return { success: true, package_id: pkg?.id };
        }
        case "dispatch_pending_order": {
            const { order_id, reasoning } = input as any;
            await supabase.from("dispatch_queue").update({ status: "dispatched", last_attempted: new Date().toISOString() }).eq("order_id", order_id).eq("status", "pending");
            const { error } = await supabase.rpc("sql", { query: `UPDATE dispatch_queue SET attempts = attempts + 1, last_attempted = now() WHERE order_id = $1`, params: [order_id] }).catch(() => ({ error: null }));
            if (error) return { error: error.message };
            await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "order_dispatched", reasoning, tool_used: "dispatch_pending_order", payload: { order_id }, outcome: "Order marked dispatched in queue" });
            return { success: true };
        }
        case "log_no_action": {
            const { summary } = input as any;
            await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "no_action", reasoning: summary, tool_used: "log_no_action", payload: {}, outcome: "No intervention required" });
            return { success: true };
        }
        default:
            return { error: `Unknown tool: ${toolName}` };
    }
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    const cronHeader = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");
    let authorized = false;
    if (PLATFORM_CRON_SECRET && cronHeader === PLATFORM_CRON_SECRET) {
        authorized = true;
    } else if (authHeader) {
        const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
        const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
        if (!authErr && user) {
            const svcClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
            const { data: profile } = await svcClient.from("profiles").select("role").eq("id", user.id).single();
            if (profile?.role === "admin") authorized = true;
        }
    }
    if (!authorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const runId = crypto.randomUUID();

    try {
        await Promise.allSettled([
            activateScheduledTransfers(supabase),
            sendTravelReminders(supabase),
            sendMerchantOverdueWarnings(supabase),
            checkRateExpiry(supabase),
            checkProgressionUnlocks(supabase),
            orchestrateLiquidity(supabase),
        ]);

        if (!GROQ_API_KEY) {
            console.log("[platform_intelligence] GROQ_API_KEY not set — pre-steps only");
            return new Response(JSON.stringify({ success: true, run_id: runId, pre_steps_only: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const systemPrompt = `You are the G-Taxi Platform Intelligence Agent for Trinidad and Tobago. Run every 2 minutes, check system state, make targeted interventions. Rules: 1. Activate surge ONLY when demand_score >= 1.4. 2. Create package drafts ONLY when a flight has >= 10 seats AND margin > 50000 cents. 3. Dispatch orders pending > 10 min with attempts < 3. 4. Always call log_no_action if nothing meets threshold. 5. At most 3 interventions per run. Currency: TTD.`;

        const messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: "Run your 2-minute platform check. Gather data and make interventions where thresholds are met." }];

        let continueLoop = true;
        let iterations = 0;
        const MAX_ITERATIONS = 10;

        while (continueLoop && iterations < MAX_ITERATIONS) {
            iterations++;
            const groqTools = TOOLS.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 4096, tools: groqTools, tool_choice: "auto", messages: [{ role: "system", content: systemPrompt }, ...messages] }),
            });
            if (!groqRes.ok) {
                const errText = await groqRes.text();
                throw new Error(`Groq API error ${groqRes.status}: ${errText}`);
            }
            const groqResponse = await groqRes.json();
            const choice = groqResponse.choices?.[0];
            if (!choice) throw new Error("Groq returned no choices");
            const assistantMsg = choice.message;
            messages.push(assistantMsg);
            if (choice.finish_reason === "stop" || !assistantMsg.tool_calls?.length) {
                continueLoop = false;
            } else if (choice.finish_reason === "tool_calls" || assistantMsg.tool_calls?.length) {
                if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 5) {
                    await supabase.from("system_alerts").insert({ type: "RATE_LIMIT_BURST", title: "Anomaly Detected: AI Tool Spam", details: { message: `AI attempted ${assistantMsg.tool_calls.length} tools in one step.` }, severity: "CRITICAL" }).catch(() => null);
                    throw new Error("Circuit breaker: AI exceeded 5 concurrent tool calls.");
                }
                for (const toolCall of assistantMsg.tool_calls ?? []) {
                    let parsedInput: Record<string, unknown> = {};
                    try { parsedInput = JSON.parse(toolCall.function.arguments); } catch {}
                    const result = await executeTool(toolCall.function.name, parsedInput, supabase, runId);
                    messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
                }
            } else {
                continueLoop = false;
            }
        }

        return new Response(JSON.stringify({ success: true, run_id: runId, iterations }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[platform_intelligence] error:", msg);
        await supabase.from("agent_decision_log").insert({ run_id: runId, decision_type: "no_action", reasoning: `Agent run failed: ${msg}`, tool_used: null, payload: {}, outcome: "error" }).catch(() => null);
        return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});