// Every edge function in this project used to hardcode
// 'Access-Control-Allow-Origin': '*' as a module-level constant — 133
// occurrences across ~119 functions, confirmed by grep 2026-09-06. That let
// any website's browser-side JS call these functions on a signed-in visitor's
// behalf. Admin is not deployed anywhere yet (confirmed by the owner
// 2026-09-06), so today the only real caller sending a browser Origin header
// is local dev — but the fix has to work the same way once a real production
// URL exists, without another pass through every function.
//
// Set ALLOWED_ORIGINS once as a Supabase project secret (comma-separated) to
// add the production admin URL when it's deployed — no code change needed.
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

function allowedOrigins(): string[] {
  const env = Deno.env.get("ALLOWED_ORIGINS");
  if (!env) return DEFAULT_ALLOWED_ORIGINS;
  const parsed = env.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

// Reflects the request's Origin back only if it's on the allowlist (the
// standard "reflect-if-allowed" CORS pattern) — otherwise falls back to the
// first allowed origin, so the header is never a bare '*'. Mobile apps
// (Expo/RN) call these functions via supabase.functions.invoke() server-side,
// not a browser fetch, so they never send a matching Origin and are
// unaffected either way — this only hardens the browser-facing (admin web)
// surface. Must be called per-request (needs `req`), never cached as a
// module-level constant — that shape is exactly the bug being fixed here.
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
