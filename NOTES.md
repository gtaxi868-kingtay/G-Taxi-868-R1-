# NOTES

## User Preferences (Teaching)

- Prefers high-level architecture explained before diving into setup
- Concerned about "endless review cycles" — wants automated gap detection, not more manual audits
- Wants Jarvis to ask questions when uncertain rather than guessing
- Wants a visual interface (TikTok-style dashboard) eventually
- Wants all tools connected in one system
- Wants the system reusable for future projects

## OpenJarvis Status (as of 2026-06-17)

- **Version**: 1.0.2
- **Status**: Installed at ~/.local/bin/jarvis
- **Config**: Currently points to cloud (OpenRouter) — needs local-first reconfiguration
- **Models available**: qwen3.5:9b, qwen3.5:4b, qwen3.5:2b, deepseek-coder:6.7b, qwen2.5-coder:7b
- **MEMORY.md**: Empty — no project context yet
- **SOUL.md**: Minimal — "You are Jarvis, a helpful personal AI assistant"
- **USER.md**: Empty
- **Skills**: None installed yet
- **Scripts**: Install/build scripts in .scripts/, no project-specific ones yet

## Project-Specific Setup Needed

1. Point Jarvis at AGENTS.md as its primary context
2. Create MEMORY.md with G-Taxi architecture summary
3. Build gap-scanner skill that cross-references AGENTS.md claims against source
4. Build sub-agent presets for each audit domain
5. Configure local model as default (not cloud)
6. Set up scheduled audit (launchd or cron)
7. Install desktop app for visual interface
