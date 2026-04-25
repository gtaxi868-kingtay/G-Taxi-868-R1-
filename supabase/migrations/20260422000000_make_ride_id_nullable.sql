-- Make ride_id nullable to support global AI insights (not tied to specific rides)
ALTER TABLE public.ride_events ALTER COLUMN ride_id DROP NOT NULL;
-- Insert welcome AI insight (global, not tied to any ride)
INSERT INTO public.ride_events (ride_id, event_type, metadata)
VALUES (
  NULL, 
  'ai_insight', 
  '{"message": "Welcome to G-Taxi! I am ready to assist your journey.", "proactive": null}'
);
