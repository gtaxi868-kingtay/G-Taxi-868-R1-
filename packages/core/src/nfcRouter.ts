import { SupabaseClient } from '@supabase/supabase-js';

export type NodeType = 'merchant' | 'taxi_stand' | 'blank' | 'personal';

export interface RoutedNode {
  type: NodeType;
  tag_uid: string;
  node_id?: string;
  merchant_id?: string;
  merchant_name?: string;
  location_name?: string;
  lat?: number;
  lng?: number;
}

export async function routeNfcTag(
  supabase: SupabaseClient,
  token: string
): Promise<RoutedNode> {
  const tagUid = token.replace(/^https?:\/\/[^\/]+\/node\//, '').trim();

  const { data: kiosk } = await supabase
    .from('kiosk_nodes')
    .select('id, tag_uid, location_name, lat, lng, merchant_id, merchants(name)')
    .eq('tag_uid', tagUid)
    .maybeSingle();

  if (kiosk) {
    const isMerchant = !!kiosk.merchant_id;
    return {
      type: isMerchant ? 'merchant' : 'taxi_stand',
      tag_uid: kiosk.tag_uid,
      node_id: kiosk.id,
      merchant_id: kiosk.merchant_id,
      merchant_name: (kiosk as any).merchants?.name,
      location_name: kiosk.location_name,
      lat: kiosk.lat,
      lng: kiosk.lng,
    };
  }

  // unified_identities is the table register_unified_identity/_admin
  // actually write to (e.g. Carnival band keychains) -- identity_tags is
  // the older table. A tag registered only in unified_identities used to
  // fall through to 'blank' here, sending the tag's own owner to the
  // "provision this as a new node" screen for a tag they already own.
  const { data: unified } = await supabase
    .from('unified_identities')
    .select('tag_uid, profile_id')
    .eq('tag_uid', tagUid)
    .maybeSingle();

  if (unified) {
    return {
      type: 'personal',
      tag_uid: unified.tag_uid,
    };
  }

  const { data: identity } = await supabase
    .from('identity_tags')
    .select('tag_uid, profile_id')
    .eq('tag_uid', tagUid)
    .maybeSingle();

  if (identity) {
    return {
      type: 'personal',
      tag_uid: identity.tag_uid,
    };
  }

  return {
    type: 'blank',
    tag_uid: tagUid,
  };
}
