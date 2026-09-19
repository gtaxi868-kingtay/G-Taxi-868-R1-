import os
import time
import logging
from typing import List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Try AGY SDK; fall back to direct LLM if unavailable.
#
# google-antigravity is a real, Google-published SDK (Apache 2.0,
# https://github.com/Google-Antigravity/antigravity-sdk-python) -- but this
# file's original AGY integration was written against an API that doesn't
# exist: `from google_antigravity import ...` (underscore) is not an
# importable module at all -- the real top-level package is `google.antigravity`
# (dotted, a namespace under `google`). That's a plain ImportError, every
# time, regardless of whether the pip package is installed. It also called
# `Conversation(agent=agent)` / `.send_message()` synchronously, an API shape
# that doesn't exist anywhere in the real SDK (real Conversation is
# `Conversation.create(strategy)`, async, and takes a ConnectionStrategy +
# ToolRunner, not an Agent). And it never required GEMINI_API_KEY, which
# this SDK needs to talk to Gemini -- confirmed from the real README, fetched
# 2026-09-14 (pypi.org/pypi/google-antigravity/json), not assumed.
try:
    from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
    from google.antigravity.hooks.policy import deny, allow
    _AGY_IMPORTED = True
except ImportError:
    _AGY_IMPORTED = False
    print("WARNING: google.antigravity not installed. Using direct Groq fallback.")

from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jarvis")

# ── Config ──────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
JARVIS_SECRET = os.getenv("JARVIS_SECRET", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PORT = int(os.getenv("PORT", "8000"))

# The SDK importing successfully isn't enough -- it needs a real key to talk
# to Gemini. Without GEMINI_API_KEY set, Agent() would construct fine and
# fail on the first real call; check for it up front so the health endpoint
# and logs are honest about which mode is actually active.
AGY_AVAILABLE = _AGY_IMPORTED and bool(GEMINI_API_KEY)
if _AGY_IMPORTED and not GEMINI_API_KEY:
    print("WARNING: google.antigravity installed but GEMINI_API_KEY not set. Using direct Groq fallback.")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ── Models ──────────────────────────────────────────────────
class ConciergeRequest(BaseModel):
    user_id: str
    user_name: str = "Guest"
    is_home_mode: bool = True
    hour: int = 12
    is_rush_hour: bool = False
    lat: Optional[float] = None
    lng: Optional[float] = None
    destination_name: Optional[str] = None
    poi_data: List[dict] = []
    # The rider's own access token, forwarded by ai_concierge_proactive.
    # No longer used by initiate_lime_fleet (that now files a
    # g_proposed_actions row instead of acting directly, so it only needs
    # user_id) -- kept on the request shape for any future tool that does
    # need to act as the calling rider specifically.
    access_token: Optional[str] = None

class ConciergeResponse(BaseModel):
    suggestion: str
    meta: dict = {}

class HealthResponse(BaseModel):
    status: str
    agy_available: bool
    version: str = "1.0.0"

# ── Tools ───────────────────────────────────────────────────

def record_user_preference(user_id: str, like: Optional[str] = None, dislike: Optional[str] = None) -> str:
    """Record a user's like or dislike into their psychological profile."""
    try:
        supabase.rpc("update_user_memory", {
            "p_user_id": user_id,
            "p_like": like,
            "p_dislike": dislike,
        }).execute()
        return "Preference recorded."
    except Exception as e:
        logger.error(f"record_user_preference failed: {e}")
        return f"Failed: {e}"

def enable_memory_tracking(user_id: str) -> str:
    """Enable memory tracking after explicit user consent."""
    try:
        supabase.rpc("enable_memory_tracking", {"p_user_id": user_id}).execute()
        return "Memory tracking enabled."
    except Exception as e:
        logger.error(f"enable_memory_tracking failed: {e}")
        return f"Failed: {e}"

def make_initiate_lime_fleet(user_id: str):
    """
    Builds the initiate_lime_fleet tool bound to THIS request's rider.

    Previously called create_split_session directly with the rider's own
    access token -- meaning a wrong AI guess about friend count/fare created
    a real, other-people-visible split session with zero admin oversight,
    the one action in this codebase that bypassed the propose/approve/
    execute pattern every other consequential action goes through. Now it
    files a g_proposed_actions row (category: money) instead of acting --
    same table, same Approvals.tsx inbox, same g_execute_action handler
    registry G's own proposals use. Reviewed code (g_execute_action's
    initiate_lime_fleet handler) creates the real split_sessions row only
    after an admin approves, using p_user_id from the row rather than a
    rider access token that may have long since expired by decision time.
    """
    def initiate_lime_fleet(friend_count: Optional[int] = None) -> str:
        """
        Propose a split-fare session for a group outing, pending admin approval.
        """
        try:
            count = friend_count or 3
            total = 40000  # $400 TTD placeholder
            participant_count = count + 1
            share = total // participant_count

            supabase.table("g_proposed_actions").insert({
                "department": "jarvis",
                "action_type": "initiate_lime_fleet",
                "title": f"Lime Fleet for {participant_count} people",
                "reasoning": "Rider asked Jarvis to start a group split-fare via chat.",
                "category": "money",
                "amount_cents": total,
                "payload": {
                    "rider_id": user_id,
                    "friend_count": count,
                    "participant_count": participant_count,
                    "share_cents": share,
                },
                "status": "pending",
            }).execute()

            return (
                f"I've sent this to the team for a quick check -- you'll hear back shortly "
                f"about your Lime Fleet for {participant_count} people."
            )
        except Exception as e:
            logger.error(f"initiate_lime_fleet failed: {e}")
            return "I couldn't set up the Lime Fleet right now. Try again in a moment."

    return initiate_lime_fleet

# ── AGY Agent Setup ─────────────────────────────────────────

def build_agent_config(user_id: str, user_name: str, opted_in: bool) -> "LocalAgentConfig":
    """
    Builds the LocalAgentConfig for this request's rider. Real usage per the
    SDK's own README ("Simple Agent" / "Custom Tools" sections): plain Python
    functions in `tools=`, `system_instructions` (plural -- not the singular
    `system_instruction` this file used to pass), and `capabilities=
    CapabilitiesConfig()` -- Agent runs READ-ONLY by default per the SDK docs,
    so without this, record_user_preference/enable_memory_tracking/
    initiate_lime_fleet would all be silently blocked even with AGY working.
    GEMINI_API_KEY is picked up from the environment automatically (same
    convention as the SDK's own quickstart, which doesn't pass api_key
    explicitly for the non-Vertex path) -- already verified present via
    AGY_AVAILABLE before this is ever called.

    CapabilitiesConfig() alone would unlock every built-in Antigravity tool,
    not just the three defined here -- the SDK's own "Hooks and Policies"
    docs list built-ins like view_file/run_command, which have no business
    being reachable from a rider-facing chat endpoint. deny("*") first, then
    allow only the three tools actually passed in, closes that off --
    everything unrecognized stays refused rather than silently exposed.
    """
    tools = [record_user_preference, enable_memory_tracking, make_initiate_lime_fleet(user_id)]

    opt_in_instruction = (
        "The user has NOT opted in to memory tracking. Politely ask for permission. "
        "If they agree, use enable_memory_tracking immediately. "
        "Do NOT use record_user_preference until they opt in."
    ) if not opted_in else (
        "The user HAS opted in. If they mention liking or hating something, "
        "use record_user_preference to save it permanently."
    )

    system_instructions = (
        "Your name is G. You are a highly attentive, deeply personal concierge for the G-Platform. "
        "You anticipate needs before the user asks. Warm, polite, authoritative yet friendly. "
        f"You are talking to: {user_name}. {opt_in_instruction} "
        "CRITICAL: If the user mentions meeting friends, going out, or 'liming', "
        "use initiate_lime_fleet IMMEDIATELY. Offer a split-fare 'Lime Fleet' with individual cars "
        "for everyone — no designated driver needed. All rides are monitored for safety.\n\n"
        "Trinidad & Tobago Core Capabilities (offer proactively when relevant):\n"
        "1. Carnival: Secure fete tickets, J'ouvert drivers, costume collection runners.\n"
        "2. Inter-Island: Snipe CAL/ferry tickets to Tobago, coordinate villas, pre-stock fridge.\n"
        "3. Flash Flood Evasion: Rainy season warnings for POS/Churchill-Roosevelt, early departure rides.\n"
        "4. Local Eats: Proxy runners for Doubles (Debe/Curepe) or Bake & Shark (Maracas) via Merchant app.\n"
        "5. VIP Nightlife: Pre-book Ariapita Ave booths, close-protection drivers, safe extraction.\n\n"
        "Never suggest things the user dislikes. Weave in things they like. Keep itineraries exciting."
    )

    return LocalAgentConfig(
        system_instructions=system_instructions,
        tools=tools,
        capabilities=CapabilitiesConfig(),
        policies=[
            deny("*"),
            allow("record_user_preference"),
            allow("enable_memory_tracking"),
            allow("initiate_lime_fleet"),
        ],
    )

# ── Direct LLM Fallback (if AGY unavailable) ────────────────

async def direct_llm_fallback(req: ConciergeRequest, likes: List[str], dislikes: List[str]) -> str:
    """Fallback using Groq directly when AGY SDK is not available.

    Model pinned to match supabase/functions/_shared/ai_model.ts's
    GROQ_CHAT_MODEL -- llama-3.3-70b-versatile (what this literally said until
    now) moved off Groq's free developer plan and 404s on every call, exactly
    the bug documented there as having already broken 5 other features in
    this app. openai/gpt-oss-120b spends completion_tokens on a hidden
    chain-of-thought before the visible answer, so max_tokens must have real
    headroom (60 returned empty content, all of it burned on reasoning) and
    reasoning_effort needs to be turned down -- same two fixes _shared/llm.ts
    already applies for this model, kept in sync by hand since Jarvis is a
    separate Python service that doesn't import that file.
    """
    if not GROQ_API_KEY:
        raise RuntimeError("No AI provider available")

    poi_text = "No POIs nearby."
    if req.poi_data:
        poi_text = "Nearby: " + ", ".join(
            f"{p['name']} ({p['category']})" for p in req.poi_data[:3]
        )

    time_block = (
        "morning" if 6 <= req.hour < 11 else
        "lunch" if 11 <= req.hour < 14 else
        "afternoon" if 14 <= req.hour < 18 else
        "evening"
    )

    prompt = f"""You are G, a concierge for G-Platform in Trinidad & Tobago.
User: {req.user_name}
Time: {time_block} ({req.hour}:00 AST)
Location: {req.lat}, {req.lng}
POIs: {poi_text}
Likes: {', '.join(likes) if likes else 'None'}
Dislikes: {', '.join(dislikes) if dislikes else 'None'}
Mode: {'Home' if req.is_home_mode else f'Riding to {req.destination_name}'}

Give ONE brief, warm suggestion (10-15 words). Include an emoji."""

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={
                "model": "openai/gpt-oss-120b",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 512,
                "reasoning_effort": "low",
                "temperature": 0.7,
            },
        )
        res.raise_for_status()
        data = res.json()
        return data["choices"][0]["message"]["content"].strip()

# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(title="G-Platform Jarvis")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="healthy", agy_available=AGY_AVAILABLE)

@app.post("/concierge", response_model=ConciergeResponse)
async def concierge(req: ConciergeRequest, x_jarvis_secret: Optional[str] = Header(None)):
    # Auth check
    if not JARVIS_SECRET or x_jarvis_secret != JARVIS_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    start = time.time()

    # Fetch user profile
    profile_res = supabase.table("user_psychological_profiles").select("*").eq("user_id", req.user_id).execute()
    profile = profile_res.data[0] if profile_res.data else None

    likes = profile.get("likes", []) if profile else []
    dislikes = profile.get("dislikes", []) if profile else []
    opted_in = profile.get("memory_opt_in", False) if profile else False

    # Build context for AGY or fallback
    poi_context = "No POIs nearby."
    if req.poi_data:
        poi_context = "Nearby options: " + ", ".join(
            f"{p['name']} ({p['category']}{' - PARTNER' if p.get('is_partner') else ''}) at {p.get('distance_meters', '?')}m"
            for p in req.poi_data[:5]
        )

    traffic_context = (
        "EXPECT HEAVY TRAFFIC. Rush hour on Highway/Main Road."
        if req.is_rush_hour else "Traffic flowing normally."
    )

    try:
        if AGY_AVAILABLE:
            config = build_agent_config(req.user_id, req.user_name, opted_in)

            context = (
                f"USER ID: {req.user_id}\n"
                f"Name: {req.user_name}\n"
                f"Time: {req.hour}:00 AST\n"
                f"Location: {req.lat}, {req.lng}\n"
                f"Destination: {req.destination_name or 'N/A'}\n"
                f"Mode: {'Home/Idle' if req.is_home_mode else 'In Ride'}\n"
                f"Traffic: {traffic_context}\n"
                f"POIs: {poi_context}\n"
                f"User Likes: {', '.join(likes) if likes else 'None'}\n"
                f"User Dislikes: {', '.join(dislikes) if dislikes else 'None'}\n\n"
                f"Respond warmly and concisely. Suggest ONE thing."
            )

            # Real API (Layer 1, "Simple Agent" in the SDK's own README):
            # Agent is an async context manager, .chat() is async, and the
            # response text is itself awaited -- none of which the previous
            # Conversation(agent=agent).send_message() shape provided, because
            # that shape isn't part of the real SDK at all.
            async with Agent(config) as agent:
                response = await agent.chat(context)
                suggestion = (await response.text()).strip()
        else:
            suggestion = await direct_llm_fallback(req, likes, dislikes)

        latency = int((time.time() - start) * 1000)
        logger.info(f"Concierge | user={req.user_id} | latency={latency}ms | agy={AGY_AVAILABLE}")

        return ConciergeResponse(
            suggestion=suggestion,
            meta={"provider": "agy" if AGY_AVAILABLE else "groq-direct", "latency_ms": latency},
        )

    except Exception as e:
        logger.error(f"Concierge error for {req.user_id}: {e}")
        raise HTTPException(status_code=503, detail="AI service error")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
