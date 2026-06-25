/*
  # Fix RLS data exposures

  1. waitlist table
    - Drop the public SELECT policy that let anyone read all signups
    - New policy: only authenticated users with admin role can read

  2. rides table (searching status)
    - Restrict the "Drivers can see available rides" policy
    - Only authenticated users who have a linked driver record can see them
*/

-- Fix 1: waitlist - close public read
DROP POLICY IF EXISTS "Waitlist entries publicly readable" ON waitlist;

CREATE POLICY "Admins can read waitlist entries"
  ON waitlist
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Fix 2: rides searching - only for registered drivers
DROP POLICY IF EXISTS "Drivers can see available rides" ON rides;

CREATE POLICY "Drivers can see available rides"
  ON rides
  FOR SELECT
  TO authenticated
  USING (
    status = 'searching'::ride_status
    AND EXISTS (
      SELECT 1 FROM drivers
      WHERE drivers.user_id = auth.uid()
    )
  );
