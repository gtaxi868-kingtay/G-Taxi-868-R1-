import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

# Antigravity SDK imports (conceptual, based on the skill guide)
from google_antigravity import LocalAgentConfig, Agent, Conversation

load_dotenv()

app = FastAPI(title="G-Platform Jarvis Agents")

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
else:
    supabase = None
    print("Warning: Supabase credentials not found.")

class ConciergeRequest(BaseModel):
    user_id: str
    user_name: str
    context: str

@app.post("/concierge")
async def handle_concierge(req: ConciergeRequest):
    """
    The G-Butler Agent Endpoint.
    Retrieves user memory, formats the prompt, and delegates to the AGY Agent.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")

    # 1. Retrieve psychological profile
    profile_res = supabase.table("user_psychological_profiles").select("*").eq("user_id", req.user_id).execute()
    
    likes = []
    dislikes = []
    if profile_res.data and len(profile_res.data) > 0:
        profile = profile_res.data[0]
        likes = profile.get("likes", [])
        dislikes = profile.get("dislikes", [])
        
    memory_context = f"User Likes: {', '.join(likes) if likes else 'Unknown'}. User Dislikes: {', '.join(dislikes) if dislikes else 'Unknown'}."

    # 2. Configure Antigravity Agent
    # Assuming GEMINI_API_KEY is in the environment
    agent_config = LocalAgentConfig() 
    
    butler_agent = Agent(
        config=agent_config,
        system_instruction=(
            "You are the G-Butler, a highly attentive, deeply personal concierge for the G-Taxi platform. "
            "You anticipate needs before the user asks. Keep responses warm but concise (under 20 words). "
            "Never suggest things the user dislikes. Always try to weave in things they like."
        )
    )
    
    # 3. Execute Conversation
    conversation = Conversation(agent=butler_agent)
    prompt = f"Current Context: {req.context}\nUser Memory: {memory_context}\nProvide a single recommendation or greeting."
    
    response = conversation.send_message(prompt)
    
    return {"suggestion": response.text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
