-- Dispatch sweep every 20 seconds instead of every minute (2026-10-27).
--
-- Why: the sweep is what offers a ride to the NEXT driver after one lets an
-- offer run out or declines. Once a minute meant a rider could sit up to 60 s
-- between drivers. Ride offers now last 30 s, so a 20 s sweep moves to the
-- next driver within ~20 s of an expiry. The first offer no longer waits for
-- the sweep at all: create_ride calls process_dispatch_queue for the new ride
-- immediately.
--
-- pg_cron is 1.6.4 on this project, which supports 'N seconds' schedules.
-- Each run is one edge call; ~4,300 calls/day, well inside the plan.
SELECT cron.alter_job(
    job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'process-dispatch-queue-1min'),
    schedule := '20 seconds'
);
