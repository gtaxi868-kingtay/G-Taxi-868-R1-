// Supabase Edge Function: platform_intelligence
// AI agent (Groq llama-3.3-70b with tool_use) that runs every 15 min via pg_cron.
// Reads demand data, unmatched orders, and flight inventory.
// Makes decisions: activate surge, dispatch orders, create package drafts.
// Logs all decisions + reasoning to agent_decision_log.
// Self-contained — no _shared/ imports.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Tool definitions for Claude ───────────────────────────────────────────────

const TOOLS = [
    {
        name: "get_demand_hotspots",
        description: "Returns geohash zones where demand/supply ratio >= threshold. Use this to find areas that need surge pricing.",
        input_schema: {
            type: "object",
            properties: {
                min_score: {
                    type: "number",
                    description: "Minimum demand_score to include. Default 1.4 (40% more demand than supply).",
                },
            },
            required: [],
        },
    },
    {
        name: "get_order_dispatch_queue",
        description: "Returns pending orders that need a driver dispatched (courier/laundry delivery methods). These orders have no driver and are sitting idle.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "get_package_opportunities",
        description: "Returns available flight inventory with seats available for Caribbean travel packages. Use to identify package creation opportunities.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    {
        name: "set_surge_multiplier",
        description: "Activates or updates surge pricing for a geographic zone. Call this when demand_score >= 1.4.",
        input_schema: {
            type: "object",
            properties: {
                center_lat: { type: "number", description: "Center latitude of surge zone" },
                center_lng: { type: "number", description: "Center longitude of surge zone" },
                radius_meters: { type: "number", description: "Radius in meters. Use 2000 for geohash-sized zones." },
                multiplier: { type: "number", description: "Price multiplier. 1.2 for mild surge, 1.5 for heavy, 2.0 for extreme." },
                reason: { type: "string", description: "Human-readable reason for surge activation" },
                expires_minutes: { type: "number", description: "Minutes until surge expires. Default 30." },
            },
            required: ["center_lat", "center_lng", "multiplier", "reason"],
        },
    },
    {
        name: "create_package_draft",
        description: "Creates a draft travel package from flight inventory. Admin must review and publish it. Use when a flight has 10+ available seats and complementary accommodation exists.",
        input_schema: {
            type: "object",
            properties: {
                flight_inventory_id: { type: "string", description: "UUID of the flight_inventory row" },
                title: { type: "string", description: "Package title, e.g. 'Tobago Weekend Escape'" },
                destination_name: { type: "string", description: "Human-readable destination" },
                price_per_person_cents: { type: "number", description: "Suggested retail price per person in TTD cents" },
                reasoning: { type: "string", description: "Why this package is viable" },
            },
            required: ["flight_inventory_id", "title", "destination_name", "price_per_person_cents", "reasoning"],
        },
    },
    {
        name: "dispatch_pending_order",
        description: "Marks a queued order as dispatched and records it. In production this would assign a nearby driver; for now it logs the dispatch intent.",
        input_schema: {
            type: "object",
            properties: {
                order_id: { type: "string", description: "UUID of the order to dispatch" },
                reasoning: { type: "string", description: "Why this order was selected for dispatch" },
            },
            required: ["order_id", "reasoning"],
        },
    },
    {
        name: "log_no_action",
        description: "Call this when conditions don't warrant any intervention. Logs that the agent ran and found nothing requiring action.",
        input_schema: {
            type: "object",
            properties: {
                summary: { type: "string", description: "Brief summary of current system state" },
            },
            required: ["summary"],
        },
    },
];

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(
    toolName: string,
    input: Record<string, unknown>,
    supabase: ReturnType<typeof createClient>,
    runId: string,
): Promise<unknown> {
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
            const { center_lat, center_lng, radius_meters, multiplier, reason, expires_minutes } = input as {
                center_lat: number;
                center_lng: number;
                radius_meters?: number;
                multiplier: number;
                reason: string;
                expires_minutes?: number;
            };

            const expiresAt = new Date(Date.now() + ((expires_minutes ?? 30) * 60 * 1000)).toISOString();
            const radius = radius_meters ?? 2000;

            const { data: zoneId, error } = await supabase.rpc("admin_set_surge_zone", {
                p_lat: center_lat,
                p_lng: center_lng,
                p_radius_km: radius / 1000,
                p_multiplier: multiplier,
                p_expires_at: expiresAt,
            });

            if (error) {
                // Fallback: direct insert
                const { data: inserted, error: insertErr } = await supabase
                    .from("pricing_zones")
                    .insert({
                        center_lat,
                        center_lng,
                        radius_meters: radius,
                        multiplier,
                        reason,
                        expires_at: expiresAt,
                        is_active: true,
                    })
                    .select("id")
                    .single();
                if (insertErr) return { error: insertErr.message };

                await supabase.from("agent_decision_log").insert({
                    run_id: runId,
                    decision_type: "surge_activated",
                    reasoning: reason,
                    tool_used: "set_surge_multiplier",
                    payload: { center_lat, center_lng, multiplier, radius_meters: radius },
                    outcome: `Zone ${inserted?.id} created`,
                });

                return { success: true, zone_id: inserted?.id };
            }

            await supabase.from("agent_decision_log").insert({
                run_id: runId,
                decision_type: "surge_activated",
                reasoning: reason,
                tool_used: "set_surge_multiplier",
                payload: { center_lat, center_lng, multiplier },
                outcome: `Zone ${zoneId} activated`,
            });

            return { success: true, zone_id: zoneId };
        }

        case "create_package_draft": {
            const { flight_inventory_id, title, destination_name, price_per_person_cents, reasoning } = input as {
                flight_inventory_id: string;
                title: string;
                destination_name: string;
                price_per_person_cents: number;
                reasoning: string;
            };

            // Fetch the flight to get destination_code and wholesale cost
            const { data: flight } = await supabase
                .from("flight_inventory")
                .select("destination_code, departure_at, wholesale_price_cents, retail_price_cents")
                .eq("id", flight_inventory_id)
                .single();

            if (!flight) return { error: "Flight not found" };

            const { data: pkg, error } = await supabase
                .from("travel_packages")
                .insert({
                    title,
                    destination_code: flight.destination_code,
                    destination_name,
                    flight_inventory_id,
                    price_per_person_cents,
                    wholesale_cost_cents: flight.wholesale_price_cents,
                    max_travelers: 20,
                    status: "draft",
                    auto_generated: true,
                    departure_at: flight.departure_at,
                    flight_info: { source: "auto_generated" },
                    hotel_info: {},
                })
                .select("id")
                .single();

            if (error) return { error: error.message };

            await supabase.from("agent_decision_log").insert({
                run_id: runId,
                decision_type: "package_created",
                reasoning,
                tool_used: "create_package_draft",
                payload: { package_id: pkg?.id, flight_inventory_id, title },
                outcome: `Draft package ${pkg?.id} created for admin review`,
            });

            return { success: true, package_id: pkg?.id };
        }

        case "dispatch_pending_order": {
            const { order_id, reasoning } = input as { order_id: string; reasoning: string };

            const { error } = await supabase
                .from("dispatch_queue")
                .update({
                    status: "dispatched",
                    last_attempted: new Date().toISOString(),
                    attempts: supabase.rpc ? undefined : 1,
                })
                .eq("order_id", order_id)
                .eq("status", "pending");

            // Increment attempts regardless
            await supabase.rpc("sql", {
                query: `UPDATE dispatch_queue SET attempts = attempts + 1, last_attempted = now() WHERE order_id = $1`,
                params: [order_id],
            }).catch(() => null);

            if (error) return { error: error.message };

            await supabase.from("agent_decision_log").insert({
                run_id: runId,
                decision_type: "order_dispatched",
                reasoning,
                tool_used: "dispatch_pending_order",
                payload: { order_id },
                outcome: "Order marked dispatched in queue",
            });

            return { success: true };
        }

        case "log_no_action": {
            const { summary } = input as { summary: string };
            await supabase.from("agent_decision_log").insert({
                run_id: runId,
                decision_type: "no_action",
                reasoning: summary,
                tool_used: "log_no_action",
                payload: {},
                outcome: "No intervention required",
            });
            return { success: true };
        }

        default:
            return { error: `Unknown tool: ${toolName}` };
    }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (!GROQ_API_KEY) {
        console.error("[platform_intelligence] GROQ_API_KEY not set");
        return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const runId = crypto.randomUUID();

    try {
        const systemPrompt = `You are the G-Taxi Platform Intelligence Agent for Trinidad and Tobago.
Your job: run every 15 minutes, check system state, make targeted interventions.

Rules:
1. Activate surge ONLY when demand_score >= 1.4 in a zone. Multiplier = min(demand_score * 0.8, 2.0), rounded to nearest 0.1.
2. Create package drafts ONLY when a flight has >= 10 available seats AND margin_per_seat > 50000 cents (TTD $500).
3. Dispatch orders that have been pending > 10 minutes with attempts < 3.
4. Always call log_no_action if nothing meets the threshold — never leave a run unlogged.
5. Make at most 3 interventions per run to avoid over-automation.
6. Be conservative: wrong surge activation damages driver trust. Wrong order dispatch creates failed deliveries.

Context:
- Currency: TTD (Trinidad & Tobago Dollars)
- Service area: Port of Spain and surrounding TT
- Platform fee: 18.5% of ride fare (drops to 16% for drivers with $500+ wallet balance)
- Travel packages: Caribbean destinations (Tobago TAB, Barbados BGI, Grenada GND)`;

        const messages: Array<{ role: string; content: unknown }> = [
            {
                role: "user",
                content: "Run your 15-minute platform check. Gather relevant data and make interventions where thresholds are met.",
            },
        ];

        let continueLoop = true;
        let iterations = 0;
        const MAX_ITERATIONS = 10;

        while (continueLoop && iterations < MAX_ITERATIONS) {
            iterations++;

            // Build Groq tools (OpenAI function-calling format)
            const groqTools = TOOLS.map(t => ({
                type: "function",
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                },
            }));

            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    max_tokens: 4096,
                    tools: groqTools,
                    tool_choice: "auto",
                    messages: [
                        { role: "system", content: systemPrompt },
                        ...messages,
                    ],
                }),
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
                for (const toolCall of assistantMsg.tool_calls ?? []) {
                    let parsedInput: Record<string, unknown> = {};
                    try { parsedInput = JSON.parse(toolCall.function.arguments); } catch { /* empty args */ }

                    const result = await executeTool(toolCall.function.name, parsedInput, supabase, runId);
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result),
                    });
                }
            } else {
                continueLoop = false;
            }
        }

        return new Response(
            JSON.stringify({ success: true, run_id: runId, iterations }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[platform_intelligence] error:", msg);

        // Log the failure
        await supabase.from("agent_decision_log").insert({
            run_id: runId,
            decision_type: "no_action",
            reasoning: `Agent run failed: ${msg}`,
            tool_used: null,
            payload: {},
            outcome: "error",
        }).catch(() => null);

        return new Response(
            JSON.stringify({ error: msg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
});
