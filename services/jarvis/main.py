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
    Use this when the user explicitly states they like or dislike something, or when you infer a strong preference.
    
    Args:
        user_id: The UUID of the user.
        like: A string describing something the user likes (optional).
        dislike: A string describing something the user dislikes (optional).
    """
    if not supabase:
        return "Error: Database disconnected."
    
    try:
        # Call the secure RPC we created in the migration
        supabase.rpc(
            "update_user_memory",
            {"p_user_id": user_id, "p_like": like, "p_dislike": dislike}
        ).execute()
        return "Preference recorded successfully."
    except Exception as e:
        return f"Failed to record preference: {str(e)}"

# --- FastAPI Endpoints ---

class ConciergeRequest(BaseModel):
    user_id: str
    user_name: str
    context: str

@app.post("/concierge")
async def handle_concierge(req: ConciergeRequest):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    # Retrieve current profile to set the context
    profile_res = supabase.table("user_psychological_profiles").select("*").eq("user_id", req.user_id).execute()
    
    likes = []
    dislikes = []
    if profile_res.data and len(profile_res.data) > 0:
        profile = profile_res.data[0]
        likes = profile.get("likes", [])
        dislikes = profile.get("dislikes", [])
        
    memory_context = f"User Likes: {', '.join(likes) if likes else 'Unknown'}. User Dislikes: {', '.join(dislikes) if dislikes else 'Unknown'}."

    # Configure the Agent with tools
    agent_config = LocalAgentConfig(
        tools=[record_user_preference]
    ) 
    
    butler_agent = Agent(
        config=agent_config,
        system_instruction=(
            "You are Geoffrey, the G-Butler, a highly attentive, deeply personal concierge for the G-Platform ecosystem. "
            "You anticipate needs before the user asks. You have access to their psychological profile. "
            "Keep responses warm, polite, authoritative yet friendly (like Uncle Phil or Geoffrey from Fresh Prince), but concise. "
            f"You are currently talking to: {req.user_name}. "
            "CRITICAL: If the user mentions they like or hate something, you MUST use the `record_user_preference` tool to save it forever. "
            "Never suggest things the user dislikes. Always try to weave in things they like. "
            "Ensure their itineraries are never boring."
        )
    )
    
    conversation = Conversation(agent=butler_agent)
    
    # We must bind the tool execution to the specific user_id context safely
    # In Antigravity, we can wrap the tool or just rely on the LLM to pass the ID if we provide it in the prompt.
    prompt = f"USER ID for tools: {req.user_id}\n\nCurrent Context: {req.context}\nUser Memory: {memory_context}\n\nRespond to the user context appropriately."
    
    response = conversation.send_message(prompt)
    
    return {"suggestion": response.text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
