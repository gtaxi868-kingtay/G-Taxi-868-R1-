import os
import time
import logging
from typing import List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Try AGY SDK; fall back to direct LLM if unavailable
try:
    from google_antigravity import LocalAgentConfig, Agent, Conversation
    AGY_AVAILABLE = True
except ImportError:
    AGY_AVAILABLE = False
    print("WARNING: google_antigravity not installed. Using direct Groq fallback.")

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
PORT = int(os.getenv("PORT", "8000"))

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

def initiate_lime_fleet(user_id: str, friend_count: Optional[int] = None) -> str:
    """
    Create a split-fare session for a group outing.
    Returns a shareable session ID.
    """
    try:
        count = friend_count or 3
        total = 40000  # $400 TTD placeholder
        share = total // (count + 1)

        res = supabase.rpc("create_split_session", {
            "p_creator_id": user_id,
            "p_total_cents": total,
            "p_participant_count": count + 1,
            "p_title": "Lime Fleet",
        }).execute()

        if hasattr(res, 'data') and res.data:
            session_id = res.data.get("id") if isinstance(res.data, dict) else str(res.data)
            return (
                f"Lime Fleet created! Session ID: {session_id}. "
                f"Each person pays ${share/100:.2f} TTD. "
                f"Share this code with your friends to join."
            )
        return "Lime Fleet created. Share the session with your friends."
    except Exception as e:
        logger.error(f"initiate_lime_fleet failed: {e}")
        return "I couldn't set up the Lime Fleet right now. Try again in a moment."

# ── AGY Agent Setup ─────────────────────────────────────────

def build_agent(user_id: str, user_name: str, opted_in: bool):
    if not AGY_AVAILABLE:
        return None

    tools = [record_user_preference, enable_memory_tracking, initiate_lime_fleet]

    opt_in_instruction = (
        "The user has NOT opted in to memory tracking. Politely ask for permission. "
        "If they agree, use enable_memory_tracking immediately. "
        "Do NOT use record_user_preference until they opt in."
    ) if not opted_in else (
        "The user HAS opted in. If they mention liking or hating something, "
        "use record_user_preference to save it permanently."
    )

    system_instruction = (
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

    config = LocalAgentConfig(tools=tools)
    return Agent(config=config, system_instruction=system_instruction)

# ── Direct LLM Fallback (if AGY unavailable) ────────────────

async def direct_llm_fallback(req: ConciergeRequest, likes: List[str], dislikes: List[str]) -> str:
    """Fallback using Groq directly when AGY SDK is not available."""
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
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 60,
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
            agent = build_agent(req.user_id, req.user_name, opted_in)
            conversation = Conversation(agent=agent)

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

            response = conversation.send_message(context)
            suggestion = response.text.strip()
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
