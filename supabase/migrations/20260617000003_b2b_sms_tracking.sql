-- ── Add Guest Details to Rides ────────────────────────────────────────────────
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS guest_phone_number TEXT;

-- ── Database Webhook Trigger for send_b2b_tracking_sms ──────────────────────
-- We'll trigger the edge function whenever a ride with a billed_to_merchant_id 
-- changes status to 'assigned'.

CREATE OR REPLACE FUNCTION public.trigger_b2b_tracking_sms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only trigger when a B2B ride is assigned
    IF NEW.billed_to_merchant_id IS NOT NULL 
       AND NEW.status = 'assigned' 
       AND OLD.status != 'assigned' THEN
        
        -- Use pg_net to call the edge function asynchronously
        PERFORM net.http_post(
            url := current_setting('app.supabase_url') || '/functions/v1/send_b2b_tracking_sms',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || current_setting('app.service_role_key')
            ),
            body := jsonb_build_object(
                'ride_id', NEW.id,
                'merchant_id', NEW.billed_to_merchant_id,
                'guest_phone', NEW.guest_phone_number,
                'rider_id', NEW.rider_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_b2b_tracking_sms ON public.rides;
CREATE TRIGGER trg_b2b_tracking_sms
    AFTER UPDATE OF status ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_b2b_tracking_sms();

-- ── Referral Conversions Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id),
    merchant_id UUID REFERENCES public.merchants(id),
    converted_user_id UUID REFERENCES auth.users(id),
    converted_at TIMESTAMPTZ DEFAULT now()
);
