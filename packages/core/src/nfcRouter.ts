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
