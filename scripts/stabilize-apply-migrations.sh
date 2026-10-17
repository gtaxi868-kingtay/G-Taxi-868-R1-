#!/usr/bin/env bash
# The five database changes for branch stabilize/main-equals-live, in order.
# Each was dry-run against the live database in a rolled-back transaction on
# 2026-10-17 (results in the commit messages). Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in 20261017090000_restore_driver_referral_rewards_table \
         20261017091000_referral_rewards_retry_until_reserve_pays \
         20261016100000_rider_referral_pays_after_first_ride \
         20261016110000_rider_can_answer_item_check \
         20261017100000_shop_earns_2pct_on_drivers_it_onboards; do
  python3 scripts/apply_migration.py "supabase/migrations/$f.sql"
done
echo "All five applied."
