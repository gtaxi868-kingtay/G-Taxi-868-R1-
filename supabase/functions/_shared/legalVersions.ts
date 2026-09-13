// supabase/functions/_shared/legalVersions.ts
//
// Mirrors packages/shared/legal.ts for the one place a client app cannot
// call record_consent() itself: merchant signup. merchant_signup and
// merchant_register_with_code create the auth user server-side via
// auth.admin.createUser (service_role) — there is no rider-style session at
// that point for a client-side RPC to run as, so this edge function inserts
// directly into user_consents instead, using its own copy of the version
// constants.
//
// KEEP IN SYNC WITH packages/shared/legal.ts. If you bump a version there,
// bump it here too — an edge function cannot import from packages/shared
// (Deno bundles only supabase/functions/**), so this duplication is
// deliberate, not accidental, matching the same pattern already used for
// CORS headers being copied into every function rather than shared.

export const TERMS_VERSION = '2026-08-15';
export const PRIVACY_VERSION = '2026-08-15';
export const MERCHANT_TERMS_VERSION = '2026-08-15';
export const DATA_RETENTION_VERSION = '2026-08-15';
export const SAFETY_VERSION = '2026-08-15';

export interface ConsentDocumentRef {
  document: string;
  version: string;
}

export const MERCHANT_CONSENT_DOCUMENTS: ConsentDocumentRef[] = [
  { document: 'terms_of_service', version: TERMS_VERSION },
  { document: 'merchant_terms', version: MERCHANT_TERMS_VERSION },
  { document: 'privacy_policy', version: PRIVACY_VERSION },
  { document: 'data_retention', version: DATA_RETENTION_VERSION },
  { document: 'safety_policy', version: SAFETY_VERSION },
];

/**
 * Records consent for every document a merchant is asked to accept.
 * Called with the service-role client, so this bypasses record_consent()'s
 * auth.uid() requirement by inserting directly — safe here because the
 * caller (merchant_signup / merchant_register_with_code) has already
 * validated p_accepted_terms came from the real signup request before this
 * runs, and the user_id is the one it just created, never client-supplied.
 */
export async function recordMerchantConsents(
  supabaseAdmin: { from: (table: string) => any },
  userId: string,
  userAgent: string | null,
): Promise<void> {
  const rows = MERCHANT_CONSENT_DOCUMENTS.map((doc) => ({
    user_id: userId,
    document: doc.document,
    version: doc.version,
    user_agent: userAgent,
  }));
  await supabaseAdmin
    .from('user_consents')
    .upsert(rows, { onConflict: 'user_id,document,version', ignoreDuplicates: true })
    .then(
      (r: unknown) => r,
      (err: unknown) => console.error('[recordMerchantConsents] insert failed:', err),
    );
}
