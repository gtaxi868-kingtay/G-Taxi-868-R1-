import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

from google_antigravity import LocalAgentConfig, Agent, Conversation

load_dotenv()

app = FastAPI(title="G-Platform Jarvis Agents")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
else:
    supabase = None
    print("Warning: Supabase credentials not found.")

# --- AGY Tools for G-Butler ---

def record_user_preference(user_id: str, like: str = None, dislike: str = None) -> str:
    """
    Record a user's preference (a like or a dislike) into their permanent psychological profile.
    Args:
        user_id: The UUID of the user.
        like: A string describing something the user likes (optional).
        dislike: A string describing something the user dislikes (optional).
    """
    if not supabase: return "Error: Database disconnected."
    try:
        supabase.rpc("update_user_memory", {"p_user_id": user_id, "p_like": like, "p_dislike": dislike}).execute()
        return "Preference recorded successfully."
    except Exception as e:
        return f"Failed to record preference (Check if user opted in): {str(e)}"

def enable_memory_tracking(user_id: str) -> str:
    """
    Call this tool ONLY AFTER the user has explicitly agreed to let you learn about them and remember their preferences.
    Args:
        user_id: The UUID of the user.
    """
    if not supabase: return "Error: Database disconnected."
    try:
        supabase.rpc("enable_memory_tracking", {"p_user_id": user_id}).execute()
        return "Memory tracking enabled successfully. You can now use record_user_preference."
    except Exception as e:
        return f"Failed to enable memory tracking: {str(e)}"

# --- FastAPI Endpoints ---

class ConciergeRequest(BaseModel):
    user_id: str
    user_name: str
    context: str

@app.post("/concierge")
async def handle_concierge(req: ConciergeRequest):
    if not supabase: raise HTTPException(status_code=500, detail="Database not configured")

    profile_res = supabase.table("user_psychological_profiles").select("*").eq("user_id", req.user_id).execute()
    
    likes = []
    dislikes = []
    opted_in = False
    is_new_user = True
    
    if profile_res.data and len(profile_res.data) > 0:
        profile = profile_res.data[0]
        likes = profile.get("likes", [])
        dislikes = profile.get("dislikes", [])
        opted_in = profile.get("memory_opt_in", False)
        is_new_user = False
        
    memory_context = f"Opted In to Memory: {opted_in}. User Likes: {', '.join(likes) if likes else 'None'}. User Dislikes: {', '.join(dislikes) if dislikes else 'None'}."

    agent_config = LocalAgentConfig(
        tools=[record_user_preference, enable_memory_tracking]
    ) 
    
    opt_in_instruction = (
        "Since the user has NOT opted in to memory tracking yet, you must politely ask for their permission to learn about their habits to serve them better. "
        "If they say yes, use the `enable_memory_tracking` tool immediately. Do NOT use `record_user_preference` until they opt in."
    ) if not opted_in else (
        "The user has opted in. If they mention they like or hate something, you MUST use the `record_user_preference` tool to save it forever."
    )

    butler_agent = Agent(
        config=agent_config,
        system_instruction=(
            "Your name is G. You are a highly attentive, deeply personal concierge for the G-Platform ecosystem. "
            "You anticipate needs before the user asks. Keep responses warm, polite, authoritative yet friendly (like Uncle Phil or Geoffrey from Fresh Prince), but concise. "
            f"You are currently talking to: {req.user_name if req.user_name != 'Guest' else 'a brand new user'}. "
            f"{opt_in_instruction} "
            "Never suggest things the user dislikes. Always try to weave in things they like. Ensure itineraries are never boring."
        )
    )
    
    conversation = Conversation(agent=butler_agent)
    prompt = f"USER ID for tools: {req.user_id}\n\nCurrent Context: {req.context}\nUser Memory: {memory_context}\n\nRespond to the user context appropriately."
    
    response = conversation.send_message(prompt)
    
    return {"suggestion": response.text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
