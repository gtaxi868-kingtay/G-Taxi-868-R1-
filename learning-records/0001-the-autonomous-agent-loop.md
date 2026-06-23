# Learning Record 0001: The Autonomous Agent Loop

## Date
2026-06-17

## Context
The user has OpenJarvis v1.0.2 installed on their MacBook but hasn't configured it for their G-Taxi project. They understand Jarvis can do more than just chat — they want it as a permanent part of their development and operations loop.

## Key Insights Captured

1. **The infinite-audit problem**: The codebase is 72K+ lines across 7 apps. Manual review always finds new gaps because the surface area is too large. The solution is automated, continuous discovery — not better manual reviews.

2. **The 4-phase loop**: Discovery (automated) → Decision (agent + human) → Fix (coding agent + human) → Verify (automated). Never stops.

3. **Strategy agents vs regular auditors**: A strategy agent has a decision layer — check code, check web, ask human if still unsure. Regular auditors just run checks and report.

4. **Interface is secondary**: The CLI (jarvis ask) works fine. The desktop app adds visual activity log but isn't required. The important part is the automation, not the UI.

5. **No new integrations needed**: Jarvis uses existing CLI tools (supabase, gh, tsc, grep) via shell_exec. The user doesn't need to install new services.

## Zone of Proximal Development
- The user grasps the high-level architecture and loop
- Next step: hands-on configuration — make Jarvis aware of the G-Taxi codebase, build the first sub-agent
- Gap: The user may not know how to write agent presets or skills for OpenJarvis yet

## Questions for Next Session
- Does the user want the desktop app or CLI-first?
- What's the first audit they want to automate?
- Should the routing-to-coding-agent happen via file drops or direct API?
