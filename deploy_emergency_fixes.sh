#!/bin/bash
# Emergency Stabilization Deployment Script
# Deploys P0 fixes for wallet, admin, driver capacity, and Redis fallback

echo "🔗 Linking to Supabase project..."
supabase link --project-ref ffbbuafgeypvkpcuvdnv

echo "🔧 Repairing migration history..."
supabase migration repair --status reverted 20260324000000_ai_and_merchant_foundation

echo "📤 Pushing database migrations (including wallet hardening)..."
supabase db push

echo "🚀 Deploying Edge Functions..."
supabase functions deploy admin_force_complete
supabase functions deploy accept_ride
supabase functions deploy match_driver

echo "✅ Emergency fixes deployed!"
echo ""
echo "Deployed changes:"
echo "  1. Wallet double-spend protection (advisory locks + unique constraints)"
echo "  2. Admin force complete hardening (safety confirmations + audit logging)"
echo "  3. Driver capacity checks (prevents double assignment)"
echo "  4. Redis fallback fixes (queries all drivers when Redis empty/failed)"
echo ""
echo "Next steps:"
echo "  - Test core ride flow end-to-end"
echo "  - Run load testing to verify concurrency fixes"
