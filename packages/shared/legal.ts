// Versions of the legal documents users accept.
//
// One source for every app. If a rider signs up on the phone and a driver
// registers on another build, both must record the SAME version string or the
// consent ledger cannot prove what anyone actually agreed to.
//
// WHEN YOU PUBLISH A NEW VERSION OF A DOCUMENT:
//   1. bump the string here to the new "Last updated" date in the .md file
//   2. existing users will NOT have accepted it — that is correct and
//      deliberate. user_consents is keyed (user_id, document, version), so a
//      new version means a new acceptance is required, and the old proof is
//      preserved rather than overwritten.
//
// The value must match the `Last updated:` line of the corresponding file in
// docs/legal/.

/** docs/legal/TERMS_OF_SERVICE.md — "Last updated: 2026-06-18" */
export const TERMS_VERSION = '2026-06-18';

/** Document keys accepted by the record_consent() RPC. Keep in sync with the
 *  CHECK constraint on public.user_consents.document. */
export const LEGAL_DOCUMENTS = {
  TERMS: 'terms_of_service',
  PRIVACY: 'privacy_policy',
  DRIVER_AGREEMENT: 'driver_agreement',
  MERCHANT_TERMS: 'merchant_terms',
  DATA_RETENTION: 'data_retention',
  SAFETY: 'safety_policy',
} as const;

export type LegalDocument = typeof LEGAL_DOCUMENTS[keyof typeof LEGAL_DOCUMENTS];
