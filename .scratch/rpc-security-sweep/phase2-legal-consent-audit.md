# Phase 2 — Legal documents placement + consent recording audit (2026-08-14)

## Summary

**The consent-recording machinery is real, well-built, and secure — but it only
records ONE of six documents, and nowhere in any app can a user actually read
any of the documents they're agreeing to.** The link every "View Full
Document" button points to does not resolve. This isn't a judgment call on
whether the legal language is adequate (that's for a lawyer, per the standing
caveat on this audit) — it's a verified fact: `gtaxi.tt` does not exist as a
domain today.

## 1. What's real (better than expected)

A genuine, append-only consent ledger exists and is correctly wired for the
one document it covers:

- **`user_consents`** table — keyed `(user_id, document, version)`, RLS-hardened
  (own-row SELECT + admin SELECT only, no UPDATE/DELETE policy at all), writes
  go only through `record_consent()` which takes the user id from `auth.uid()`
  — never from client input. The migration's own comments show this was
  dry-run tested as a real rider against another user's rows before going live
  (couldn't see, edit, delete, or forge another user's consent row).
- **`record_consent()`** RPC — real, callable, correctly locked down
  (`REVOKE ALL FROM PUBLIC, anon`).
- **Rider signup** (`SignupScreen.tsx`) and **driver registration**
  (`RegisterScreen.tsx`) both call it correctly, including the edge case where
  email confirmation means no session exists yet at signup time — consent is
  queued via `savePendingSignup` and flushed by `AuthContext` on first real
  sign-in, rather than silently dropped (the previous, broken behavior,
  documented in the same file's own comments: "0 of 10 existing users carried
  the flag at all").
- **Data retention / account deletion** is real and live: `data_retention_policy`
  (11 categories, each with a real legal-basis note), a nightly cron
  (`03:15`, `purge_expired_personal_data`) that respects legal holds (an open
  incident or support ticket blocks a purge), and `anonymise_user` which
  correctly preserves the 7-year financial trail instead of hard-deleting
  `auth.users`. `SettingsScreen.tsx` genuinely calls `request_account_deletion`
  / `cancel_account_deletion` — this part of the privacy promise is no longer
  aspirational.

## 2. What's not real: 5 of 6 documents have zero consent evidence

`packages/shared/legal.ts` defines six document keys, each with a real version
string tied to a real dated file in `docs/legal/`:

| Document key | Version constant | Real .md file exists | Ever passed to `record_consent()`? |
|---|---|---|---|
| `terms_of_service` | `2026-06-18` | ✅ | **Yes** — rider signup, driver registration |
| `privacy_policy` | `2026-08-05` | ✅ | **No** |
| `driver_agreement` | `2026-08-05` | ✅ | **No** |
| `merchant_terms` | `2026-08-05` | ✅ | **No** |
| `data_retention` | `2026-08-05` | ✅ | **No** |
| `safety_policy` | `2026-08-05` | ✅ | **No** |

Grepped every real call site in `apps/` — `record_consent` is invoked exactly
twice in the whole codebase (rider signup, driver registration), and both
calls pass `LEGAL_DOCUMENTS.TERMS`. No other document key is ever used. This
means: no rider has ever recorded accepting the Privacy Policy specifically,
no driver has ever recorded accepting the Driver Operator Agreement (the
document that actually establishes independent-contractor status — the exact
legal posture both Legal screens paraphrase), and no merchant has any consent
record of any kind, for anything, ever.

## 3. The document a user is asked to accept cannot be read, anywhere

Grepped every real link in the app. Every single one — 8 instances across 4
files (`apps/rider/src/screens/LegalScreen.tsx`,
`apps/rider/src/screens/SignupScreen.tsx`,
`apps/driver/src/screens/LegalScreen.tsx`,
`apps/driver/src/screens/RegisterScreen.tsx`) — points to one of:

```
https://gtaxi.tt/legal/terms
https://gtaxi.tt/legal/privacy
```

**Verified live: `gtaxi.tt` does not resolve** (`getaddrinfo ENOTFOUND
gtaxi.tt`). There is no other domain, no `site` edge function route, and no
`qr-landing` page serving any of `docs/legal/*.md`. Confirmed by grep — those
files are referenced nowhere outside `docs/legal/` itself and the version
constants file.

**Net effect:** on both apps, at both the point of signup and the point of
later review (the dedicated Legal screen), every "View Full Document →" link
is dead. The screens themselves show only short paraphrased summaries ("VAT
compliance," "you're an independent contractor," "AI never sells your data")
— real, accurate-sounding language, but not the actual document, and the
button that promises the actual document goes nowhere. This has been true
since these screens were built; it is not something this session's changes
affected.

## 4. Two "AI privacy" toggles, same topic, only one works

- **`apps/rider/src/screens/LegalScreen.tsx`** — an "AI Predictive Assistance"
  `Switch`, presented directly under privacy/AI-governance language, backed
  by nothing but `const [aiEnabled, setAiEnabled] = useState(true)`. It is
  never read anywhere, never persisted, and resets to `true` every time the
  screen mounts. A rider who flips it off, believing they've just opted out
  of AI learning from their movement (the screen's own words), has changed
  nothing.
- **`apps/rider/src/screens/SettingsScreen.tsx`** — a *different* toggle,
  labeled "AI Route Opt-In," genuinely persists to `AsyncStorage
  (@ai_routing_opt_in)` and reads the admin's real `opt_in_ai_routing`
  platform flag via `usePlatformFlags`. This is the one that actually does
  something — but it lives on a separate screen under different wording, and
  nothing tells a rider on the Legal screen that the control they just used
  wasn't the real one.

## 5. Merchants have no consent flow at all

`MERCHANT_TERMS` (and the underlying `docs/legal/MERCHANT_TERMS.md`) is
referenced nowhere in `apps/merchant` or `apps/merchant-mobile` — no display,
no link, no consent recording. Merchant accounts are either admin-created
directly (`admin`'s `create_merchant_user` action) or self-registered via
`merchant_signup`/`merchant_register_with_code`, and neither path shows or
records anything about merchant terms.

## What this means, plainly

- The infrastructure to prove consent is real, secure, and (for one document)
  correctly wired. That is the hard part, and it is done.
- What's missing is coverage, not architecture: the same `record_consent()`
  call already proven safe for Terms of Service needs to fire for Privacy
  Policy at minimum (arguably the one that matters most given the Data
  Protection Act 2011 findings from Phase 0), and the Driver Agreement for
  drivers, before those documents mean anything as recorded consent.
- Before any of that consent is meaningful, the actual document text needs to
  be reachable from a real URL. Right now nobody — rider, driver, or
  merchant — has ever been able to open the thing they're told they're
  agreeing to.

**Flag for a lawyer, not resolved here (per this audit's standing caveat):**
whether a paraphrased summary screen plus a non-functional link to the real
document was ever sufficient consent formation under T&T law for the
acceptances already recorded to date. That is a legal judgment. Whether the
link works at all is not — that part is just a fact, verified live today.

## Evidence checked

- `supabase/migrations/20260805000000_user_consents_ledger.sql`,
  `20260806010000_data_retention_purge.sql` — full read, both real and live.
- `packages/shared/legal.ts` — the single source of document keys/versions.
- `apps/rider/src/screens/{SignupScreen,LegalScreen,SettingsScreen}.tsx`,
  `apps/driver/src/screens/{RegisterScreen,LegalScreen}.tsx` — full read of
  consent call sites and document links.
- Live grep of every `record_consent` and `LEGAL_DOCUMENTS.` reference in
  `apps/` — confirmed only `TERMS` is ever passed.
- Live grep for `MERCHANT_TERMS` in `apps/merchant`, `apps/merchant-mobile` —
  zero matches.
- Live fetch of `https://gtaxi.tt/legal/terms` — DNS resolution failure,
  confirmed today.
- `docs/legal/*.md` — confirmed all 7 files exist, real substantive content
  (7–20KB each), and each file's "Last updated" line matches its version
  constant in `packages/shared/legal.ts` exactly (the version-tracking
  discipline itself is correctly maintained — it's the serving/coverage that's
  missing).
