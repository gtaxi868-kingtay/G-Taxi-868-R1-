-- Migration: 20260225000002_add_push_tokens.sql
-- Phase 5 Fix 5.2 — Add push_token columns to drivers and profiles tables.
-- These columns store the Expo push token registered on the device at login time.
-- The token is used by server-side edge functions to send push notifications via FCM.

ALTER TABLE public.drivers  ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;
