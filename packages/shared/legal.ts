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

/** docs/legal/TERMS_OF_SERVICE.md — "Last updated: 2026-08-15" */
export const TERMS_VERSION = '2026-08-15';

/** docs/legal/PRIVACY_POLICY.md */
export const PRIVACY_VERSION = '2026-08-15';

/** docs/legal/DRIVER_OPERATOR_AGREEMENT.md */
export const DRIVER_AGREEMENT_VERSION = '2026-08-15';

/** docs/legal/MERCHANT_TERMS.md */
export const MERCHANT_TERMS_VERSION = '2026-08-15';

/** docs/legal/DATA_RETENTION_AND_DELETION.md */
export const DATA_RETENTION_VERSION = '2026-08-15';

/** docs/legal/SAFETY_AND_INCIDENT_POLICY.md */
export const SAFETY_VERSION = '2026-08-15';

// docs/legal/REFUND_AND_CANCELLATION_POLICY.md has no version constant on
// purpose: it is incorporated by reference into the Terms rather than accepted
// separately, and `user_consents.document` has no 'refund_policy' value. If it
// ever needs its own acceptance, the CHECK constraint must be altered first.

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

// Public URLs for "View Full Document" links. Each document is rendered
// to a standalone HTML page and uploaded to the public `web` Supabase
// Storage bucket at legal/<slug>.html — the bucket already serves other
// public content unauthenticated at this exact path pattern, no RLS
// policy needed (public=true on the bucket is what gates it).
//
// refund_policy has no entry in LEGAL_DOCUMENTS / no user_consents row
// (incorporated by reference into Terms, not accepted separately) but
// still gets a real linkable page here.
const LEGAL_DOC_BASE_URL = 'https://ffbbuafgeypvkpcuvdnv.supabase.co/storage/v1/object/public/web/legal';

export const LEGAL_DOC_URLS: Record<LegalDocument | 'refund_policy', string> = {
  terms_of_service: `${LEGAL_DOC_BASE_URL}/terms_of_service.html`,
  privacy_policy: `${LEGAL_DOC_BASE_URL}/privacy_policy.html`,
  driver_agreement: `${LEGAL_DOC_BASE_URL}/driver_agreement.html`,
  merchant_terms: `${LEGAL_DOC_BASE_URL}/merchant_terms.html`,
  data_retention: `${LEGAL_DOC_BASE_URL}/data_retention.html`,
  safety_policy: `${LEGAL_DOC_BASE_URL}/safety_policy.html`,
  refund_policy: `${LEGAL_DOC_BASE_URL}/refund_policy.html`,
};

export interface ConsentDocumentRef {
  document: LegalDocument;
  version: string;
}

// Which documents each role is asked to accept at signup, and the exact
// version recorded for each — always read from the constants above, never
// duplicated as a literal string here. This is the single place that
// decides "what does a rider/driver/merchant accept," so a new document
// only needs to be added in ONE list per role, not hunted down per screen.
//
// merchant_terms is deliberately absent from RIDER/DRIVER — it does not
// apply to those roles. driver_agreement is deliberately absent from
// RIDER/MERCHANT for the same reason.

export const RIDER_CONSENT_DOCUMENTS: ConsentDocumentRef[] = [
  { document: LEGAL_DOCUMENTS.TERMS, version: TERMS_VERSION },
  { document: LEGAL_DOCUMENTS.PRIVACY, version: PRIVACY_VERSION },
  { document: LEGAL_DOCUMENTS.DATA_RETENTION, version: DATA_RETENTION_VERSION },
  { document: LEGAL_DOCUMENTS.SAFETY, version: SAFETY_VERSION },
];

export const DRIVER_CONSENT_DOCUMENTS: ConsentDocumentRef[] = [
  { document: LEGAL_DOCUMENTS.TERMS, version: TERMS_VERSION },
  { document: LEGAL_DOCUMENTS.DRIVER_AGREEMENT, version: DRIVER_AGREEMENT_VERSION },
  { document: LEGAL_DOCUMENTS.PRIVACY, version: PRIVACY_VERSION },
  { document: LEGAL_DOCUMENTS.DATA_RETENTION, version: DATA_RETENTION_VERSION },
  { document: LEGAL_DOCUMENTS.SAFETY, version: SAFETY_VERSION },
];

// Merchant consent is recorded SERVER-SIDE (merchant_signup /
// merchant_register_with_code run under service_role with no rider-style
// session yet to call record_consent() as the merchant). The mirrored list
// lives in supabase/functions/_shared/legalVersions.ts — keep both in sync
// when a document or version changes; this export exists for any future
// client-side merchant consent call that does have a session.
export const MERCHANT_CONSENT_DOCUMENTS: ConsentDocumentRef[] = [
  { document: LEGAL_DOCUMENTS.TERMS, version: TERMS_VERSION },
  { document: LEGAL_DOCUMENTS.MERCHANT_TERMS, version: MERCHANT_TERMS_VERSION },
  { document: LEGAL_DOCUMENTS.PRIVACY, version: PRIVACY_VERSION },
  { document: LEGAL_DOCUMENTS.DATA_RETENTION, version: DATA_RETENTION_VERSION },
  { document: LEGAL_DOCUMENTS.SAFETY, version: SAFETY_VERSION },
];
