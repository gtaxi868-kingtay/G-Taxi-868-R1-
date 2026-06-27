# Archived migrations

These 195 fragmented migrations were the historical schema evolution. They do NOT
replay cleanly from scratch (out-of-band drift: types/seeds/cron). They have all
been applied to production already.

They are SUPERSEDED by a single baseline:
- `../migrations/00000000000000_baseline.sql` — full current prod schema (pg_dump)
- `../migrations/00000000000001_cron_jobs.sql` — consolidated pg_cron jobs (guarded)

Kept here for history/reference only. Do not re-add them to `migrations/`.

## One-time PROD cutover (NOT automatic — deploy is gated)
Prod already has every object; do NOT `db push` the baseline blindly (objects exist).
Mark the baseline as already-applied instead:
    supabase migration repair --status applied 00000000000000
    supabase migration repair --status applied 00000000000001
Then future migrations stack on top normally.
