#!/bin/bash
# setup_dummy_secrets.sh
# 
# This script injects placeholder secrets into the Supabase project to prevent
# edge functions from crashing due to missing environment variables.
# When ready, replace the placeholder values with the real API keys.

echo "Setting up dummy secrets for Supabase Edge Functions..."

# Stripe
supabase secrets set STRIPE_SECRET_KEY="sk_test_placeholder"
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_placeholder"

# WhatsApp Cloud API (replaced Twilio — free tier, 1K conversations/mo)
supabase secrets set WHATSAPP_PHONE_NUMBER_ID="placeholder"
supabase secrets set WHATSAPP_ACCESS_TOKEN="placeholder"
# When absent, system gracefully falls back to wa.me deep links (zero config)

# Firebase (FCM Push Notifications)
# Note: In production, this should be the base64 encoded JSON or raw JSON
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="{}"

# Sentry (Error Tracking)
supabase secrets set SENTRY_DSN="https://placeholder@sentry.io/1234567"

# Upstash Redis (Driver Cache)
supabase secrets set UPSTASH_REDIS_REST_URL="https://placeholder.upstash.io"
supabase secrets set UPSTASH_REDIS_REST_TOKEN="token_placeholder"

# Amadeus / Booking (G-Escape)
supabase secrets set AMADEUS_API_KEY="amadeus_key_placeholder"
supabase secrets set AMADEUS_API_SECRET="amadeus_secret_placeholder"
supabase secrets set BOOKING_API_KEY="booking_key_placeholder"

echo "Dummy secrets injected successfully."
echo "Remember to update these via the Supabase dashboard or CLI when going to production."
