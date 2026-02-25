-- 13. Scheduled Rides Support
-- Adds scheduling capability to the rides table.

-- ============================================
-- 1. ADD SCHEDULE COLUMN
-- ============================================
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- ============================================
-- 2. UPDATE STATUS ENUM & DATA SANITIZATION
-- ============================================

-- A. Sanitize existing data first (set invalid statuses to 'cancelled')
-- IMPORTANT: This is required because your database contains rows with invalid statuses
-- that violate the new check constraint. We must fix them before applying the rule.
UPDATE public.rides 
SET status = 'cancelled' 
WHERE status NOT IN ('requested', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled', 'scheduled');

-- B. Now safe to update the constraint
ALTER TABLE public.rides 
DROP CONSTRAINT IF EXISTS rides_status_check;

ALTER TABLE public.rides 
ADD CONSTRAINT rides_status_check 
CHECK (status IN ('requested', 'searching', 'assigned', 'in_progress', 'completed', 'cancelled', 'scheduled'));

-- ============================================
-- 3. INDEX FOR SCHEDULED RIDES
-- ============================================
-- Helps the dispatcher find rides active "soon"
CREATE INDEX IF NOT EXISTS idx_rides_scheduled_for 
ON public.rides (scheduled_for)
WHERE status = 'scheduled';
