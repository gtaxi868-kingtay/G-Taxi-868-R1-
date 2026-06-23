# Mission: Build an Operational AI Agent System for G-Taxi

## Why I'm Learning This

I'm building a production ride-hailing and multiplex ecosystem (G-Taxi) for Trinidad and Tobago. The codebase is 72K+ lines across 7 apps, 23 edge functions, 100+ database tables. Currently every audit finds new gaps — the surface area is too large for any single review session.

I need to break out of the endless "fix → review → find more gaps → fix" loop by building an **automated agent system** that:

1. Continuously audits the codebase for known gap patterns
2. Monitors the running production system (Supabase logs, errors, cron jobs)
3. Asks me questions when it encounters unknowns instead of guessing
4. Routes confirmed fixes back to my coding agent (the one writing code)
5. Gives me a visual interface to see what's happening

## What Success Looks Like

- Jarvis runs an automated audit every night and emails/pings me a fresh gap report
- When I start a new feature, Jarvis already knows the architecture and can check my work
- When production errors happen, Jarvis catches them before users report them
- I can reuse the same agent system for future projects without rebuilding from scratch
- I have a dashboard where I can see agent activity, answer questions, and trigger workflows

## What I'm Not Trying To Do

- I don't need to build a general-purpose AI platform
- I don't need to replace my coding agent (the one writing code in this session)
- I don't need cloud infrastructure — everything should run locally on my MacBook
