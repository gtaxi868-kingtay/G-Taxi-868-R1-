# Free LLM providers — production fallback + coding tools

Source directory: <https://github.com/open-free-llm-api/awesome-freellm-apis>
(refreshed daily; model ids below cross-checked against each provider's own docs
on 2026-09-06).

Two separate concerns, don't mix them up:

- **Part A — the platform's own AI.** G, the concierge, NL parsing, voice, push
  copy. This runs in production and must never go dark silently again.
- **Part B — your coding tools.** Claude Code / Cursor / OpenCode. Free keys here
  save quota but come with real quality limits.

---

## Part A — production AI (`supabase/functions/_shared/llm.ts`)

### What was actually broken

On **2026-08-17** every AI feature stopped working and nothing alerted.

The cause was not "Groq retired llama-3.3-70b-versatile". The model id is *still
listed* at console.groq.com/docs/models — but it now shows **"Enterprise"**, with
price and rate limits both reading *Contact Sales*. It moved off the free
developer plan. Free-tier keys started getting a hard 4xx on an id that had
worked for months.

Two things turned a provider policy change into a 19-day blackout:

1. **The gateway retried the same dead model three times, then threw.** A
   permanent change was indistinguishable from a transient blip.
2. **Six edge functions never used the gateway at all.** They had the model id
   hardcoded as a string literal, so fixing `llm.ts` did not reach them.

Evidence, from the live database:

| Signal | What it showed |
|---|---|
| `g_llm_usage` | Daily rows for finance/ops/platform_intelligence through 2026-08-17, then **nothing until 2026-09-06** |
| `cron.job_run_details` | `g-dept-finance` etc. fired all 30 days — the crons were fine, the calls inside them were not |
| `system_alerts` | `WATCHDOG_ANOMALY` "6 failed agent decisions in the last hour", recurring 2026-08-17 → 2026-09-03 |
| Deployed `generate_ai_greeting` | Still had `llama-3.3-70b-versatile` hardcoded as of today |

### What changed

**Important:** git was behind production here. The `_shared/llm.ts` deployed on
2026-09-06 already had the correct model, a model-level fallback list, the
`max_tokens` floor, `reasoning_effort`, and a dedup'd retirement alert — none of
which were on `main`. This change takes the **deployed** file as its base and
keeps all of that verbatim. Read the live bundle before editing this file; the
branch is not authoritative.

**What is genuinely new: a second axis of fallback.** The deployed gateway falls
back across *models* but only ever talks to *one provider*. That covers "Groq
retired this model". It does not cover a revoked key, a daily cap, or Groq being
down — in all three, every model in the list fails identically and G goes dark
again for a reason no model swap can fix.

`G_LLM_FALLBACKS` is now a comma-separated provider list, default
`cerebras,gemini`. Any provider without its key set is skipped, so **adding a key
is the only step needed to arm a fallback** — no redeploy. A provider-level
failover raises `G_LLM_PROVIDER_FAILOVER`, deliberately distinct from the
model-retirement alert, because the fix is different.

**The six direct callers now import `GROQ_CHAT_MODEL`** instead of hardcoding a
string. Note this does *not* give them budget metering or the fallback chain —
routing them through `chat()` is the real fix and is still outstanding.

### Configuration

Every model id is env-overridable. Nothing below is required — the defaults work
with the `GROQ_API_KEY` already set.

| Secret | Default | Effect |
|---|---|---|
| `G_LLM_PROVIDER` | `groq` | Primary provider |
| `G_LLM_FALLBACKS` | `cerebras,gemini` | Ordered fallbacks; unkeyed ones skipped |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Override without redeploying |
| `CEREBRAS_API_KEY` | *(unset)* | **Set this to arm fallback #1** |
| `GEMINI_API_KEY` | *(unset)* | **Set this to arm fallback #2** |

Providers wired and ready: `groq`, `cerebras`, `gemini`, `mistral`, `openrouter`,
`xai`. All OpenAI-compatible, all free tier, none needs a credit card except
OpenRouter's paid models.

**Recommended next step:** get a free Cerebras key (<https://cloud.cerebras.ai/>,
no card) and set `CEREBRAS_API_KEY`. That alone converts the next Groq change from
an outage into a logged failover.

---

## Part B — free keys for coding tools

### The honest limitation, first

Free-tier models are **not** a substitute for what you have been doing in this
repo. The 2026-07-16 session found eight crash bugs in money-moving SQL by
dry-running migrations against real rows and reading live `pg_proc` definitions.
No free 20B-class model does that reliably.

Where free keys genuinely pay off:

- Boilerplate: new screens matching an existing pattern, test scaffolds
- Bulk mechanical edits across many files
- Doc and comment passes
- First-draft exploration you will review anyway

Where they will cost you more than they save:

- Anything touching `wallet_transactions`, `compute_ride_split`, or RLS
- Migrations against the live database
- Anything where "TypeScript compiles" is not the same as "Postgres accepts it"

Split the work along that line and free tiers are worth having.

### Claude Code

Claude Code needs an **Anthropic-compatible** endpoint, which almost no free
provider offers. The usual route is OpenRouter, and it is **not free** — Anthropic
models there need a one-time $10 top-up.

```bash
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-..."   # openrouter.ai/keys
export ANTHROPIC_API_KEY=""                   # must be empty
```

### Cursor

```
Settings → Models → Add Model
  Model name: openai/gpt-oss-120b
  Base URL:   https://api.groq.com/openai/v1
  API key:    <your Groq key>
```

### Codex CLI / anything taking OPENAI_BASE_URL

```bash
export OPENAI_BASE_URL="https://api.groq.com/openai/v1"
export OPENAI_API_KEY="<your Groq key>"
codex --model "openai/gpt-oss-120b"
```

### Best free options for agentic coding specifically

| Provider | Model | Free limits | Card? |
|---|---|---|---|
| Groq | `openai/gpt-oss-120b` | 1K RPM, 250K TPM | No |
| Cerebras | `zai-glm-4.7` | 10 RPM, 100 RPD, 1M TPD | No |
| Google Gemini | `gemini-3.5-flash` | Generous, 1M context | No |
| OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | Free tier | Registration |

Same keys work for both parts — one Groq key covers production *and* Cursor.

Full directory, playground, and a config generator: <https://freellm.net>
