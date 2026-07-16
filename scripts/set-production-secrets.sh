#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# G-Taxi Production Secrets Injector
# Usage: chmod +x set-production-secrets.sh && ./set-production-secrets.sh
#
# Prerequisites:
#   1. Supabase CLI installed (npm install -g supabase)
#   2. Logged in: supabase login
#   3. Linked project: supabase link --project-ref <ref>
#   4. Get project ref from: supabase projects list
# ─────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ffbbuafgeypvkpcuvdnv}"
echo "→ Targeting Supabase project: $PROJECT_REF"
echo ""

# ── WiPay – Trinidad's local payment processor ──────────────
# Required for: wipay_webhook, merchant_dispatch, process_pending_wipay_settlements
# Get keys: https://dashboard.wipay.com/developers/api-keys
supabase secrets set --project-ref "$PROJECT_REF" WIPAY_API_KEY="${WIPAY_API_KEY:?WIPAY_API_KEY not set}"
supabase secrets set --project-ref "$PROJECT_REF" WIPAY_MERCHANT_ID="${WIPAY_MERCHANT_ID:?WIPAY_MERCHANT_ID not set}"
supabase secrets set --project-ref "$PROJECT_REF" WIPAY_WEBHOOK_SECRET="${WIPAY_WEBHOOK_SECRET:?WIPAY_WEBHOOK_SECRET not set}"
supabase secrets set --project-ref "$PROJECT_REF" WIPAY_PAYOUT_KEY="${WIPAY_PAYOUT_KEY:?WIPAY_PAYOUT_KEY not set}"
echo "  ✓ WiPay secrets set"
echo ""

# ── Amadeus – Flight offers, G-Escape air sync ──────────────
# Required for: sync_flight_availability (returns 503 without)
# Sign up: https://developers.amadeus.com/register
# Free tier: 2,000 API calls/month
supabase secrets set --project-ref "$PROJECT_REF" AMADEUS_API_KEY="${AMADEUS_API_KEY:?AMADEUS_API_KEY not set}"
supabase secrets set --project-ref "$PROJECT_REF" AMADEUS_API_SECRET="${AMADEUS_API_SECRET:?AMADEUS_API_SECRET not set}"
echo "  ✓ Amadeus secrets set"
echo ""

# ── Booking.com – Lodging/property sync, G-Escape stay ──────
# Required for: sync_lodging_availability (returns 503 without)
# Apply: https://partner.booking.com/
supabase secrets set --project-ref "$PROJECT_REF" BOOKING_API_KEY="${BOOKING_API_KEY:?BOOKING_API_KEY not set}"
echo "  ✓ Booking.com secret set"
echo ""

# ── Verify ──────────────────────────────────────────────────
echo "→ Verifying secrets..."
supabase secrets list --project-ref "$PROJECT_REF" --format json | \
  jq -r '.[].name' | sort > /tmp/set_secrets.txt
echo ""
echo "✓ Secrets set for project $PROJECT_REF"
echo "  Active secrets count: $(wc -l < /tmp/set_secrets.txt)"
echo ""
echo "── SUCCESS ──────────────────────────────────────────────"
echo "All 7 secrets injected. Deploy edge functions that depend"
echo "on these keys (wipay_webhook, sync_flight_availability,"
echo "sync_lodging_availability) to pick up the new values:"
echo ""
echo "  supabase functions deploy wipay_webhook --project-ref $PROJECT_REF"
echo "  supabase functions deploy sync_flight_availability --project-ref $PROJECT_REF"
echo "  supabase functions deploy sync_lodging_availability --project-ref $PROJECT_REF"
