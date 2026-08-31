Purpose

Document how to integrate local ChatDev with this repo and a minimal set of safe, non-invasive patches to glue NFC/Wallet flows.

What I inspected

- Found local ChatDev at `third_party/ChatDev` (README, run.py, server_main.py).
- Wallet/NFC integration points in this repo:
  - `apps/rider/src/screens/WalletScreen.tsx` — Pay at Store button navigates to `NfcScan`.
  - `apps/rider/src/screens/NfcScanScreen.tsx` — routes tag to `NfcPay` when in pay mode.
  - `apps/rider/src/screens/NfcPayScreen.tsx` — posts to edge function `rider_nfc_pay` at `${ENV.SUPABASE_URL}/functions/v1/rider_nfc_pay`.
  - `supabase/functions/rider_nfc_pay/index.ts` — server edge function that calls RPC `rider_wallet_payment` and requires `SUPABASE_SERVICE_ROLE_KEY` in edge env.
  - `supabase/migrations/20260708000001_rider_nfc_payment_flow.sql` — contains `rider_wallet_payment` RPC implementation.
  - `apps/merchant-mobile/src/screens/NfcAcceptPaymentScreen.tsx` — merchant side UI that accepts NFC/QR/manual payments.
  - `packages/core/src/nfcRouter.ts` and `supabase/functions/nfc_event_handler/index.ts` — single-source NFC routing logic.

Integration risks / preconditions

- `SUPABASE_SERVICE_ROLE_KEY` must be set for `rider_nfc_pay` to work; this secret must never be added to any client-side env.
- Running ChatDev locally requires Python deps (PyYAML etc.). The environment here blocked pip (network), so I couldn't run ChatDev in this sandbox.

Suggested non-invasive patches (can be applied without running ChatDev):

1) Improve client-side error handling in `NfcPayScreen.tsx` to show actionable messages for common server failures (insufficient balance, merchant tag not found, auth expired).

2) Add a feature-flag check at app startup that warns if `ENV.SUPABASE_URL` or `ENV.SUPABASE_SERVICE_ROLE_KEY` is missing on server side. (Client should NOT read service role key; instead add dev-only guidance in `tools/`.)

3) Add an instrumentation helper to `packages/core` that centralizes edge-function URL building and fallback handling. This makes it easier for ChatDev to modify patterns.

Example patch (1): Update `NfcPayScreen.tsx` to display server `error` or `error_message` and map HTTP 402 -> 'Insufficient balance'.

Runbook to execute ChatDev locally (on your machine — network required)

```bash
cd third_party/ChatDev
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
# Then run ChatDev incremental (it will act on the path you provide):
python run.py --task "Inspect g-taxi for NFC WalletScreen changes" --config incremental --path /Users/kingtay/Desktop/g-taxi-rider
```

Notes

- I created `tools/run_chatdev_for_repo.sh` as a wrapper to run ChatDev in either `dev` or `incremental` mode.
- If you want, I can now produce the concrete code patch for `NfcPayScreen.tsx` and `packages/core` helper and apply it. Tell me to proceed and I'll make those edits and run local tests (JS/TS only). If you'd rather run ChatDev locally first, run the commands above and tell me the results.
