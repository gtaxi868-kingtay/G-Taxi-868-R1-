/*
  # G-TAXI Waitlist Schema

  1. New Tables
    - `waitlist`
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `phone` (text)
      - `created_at` (timestamp)
      - `preferred_start_date` (text)
      - `preferred_slot` (text)
      - `preferred_area` (text)
      - `heard_about` (text)
      - `occupation` (text)
      - `status` (text)
  2. Security
    - Enable RLS on `waitlist` table
    - Add policy for public inserts
    - Add policy for public reads
*/

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  preferred_start_date TEXT,
  preferred_slot TEXT,
  preferred_area TEXT,
  heard_about TEXT,
  occupation TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert to waitlist"
  ON waitlist
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Waitlist entries publicly readable"
  ON waitlist
  FOR SELECT
  TO public
  USING (true);
