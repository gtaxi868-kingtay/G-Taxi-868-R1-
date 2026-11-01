import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { useAuth } from '../context/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const { supabase } = initializeSupabaseClient('native');

// The owner's phone view of brand approval. G 868 makes the look and package;
// the owner approves, asks for a change, pauses, or sends a new package.

interface Campaign {
  id: string;
  headline: string;
  offer_text: string | null;
  accent_color: string;
  audience: 'everyone' | 'my_clients';
  ends_on: string | null;
  status: string;
  authored_by_side: string;
  paused_by_side: string | null;
  change_note: string | null;
}

const OTHER_LABEL: Record<string, string> = {
  paused: 'Paused',
  awaiting_g868: 'With G 868 for review',
  changes_requested: 'G 868 is making your changes',
};

function Preview({ c }: { c: Campaign }) {
  return (
    <View style={[s.preview, { backgroundColor: c.accent_color + '33', borderLeftColor: c.accent_color }]}>
      <Text style={s.previewHead}>{c.headline}</Text>
      {c.offer_text ? <Text style={s.previewBody}>{c.offer_text}</Text> : null}
      <Text style={s.previewMeta}>
        {c.audience === 'my_clients' ? 'Shown to your clients' : 'Shown to everyone near your pin'}
        {c.ends_on ? ` until ${c.ends_on}` : ''}
      </Text>
    </View>
  );
}

export function BrandScreen({ navigation }: { navigation: NativeStackNavigationProp<any> }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [headline, setHeadline] = useState('');
  const [offer, setOffer] = useState('');
  const [clientsOnly, setClientsOnly] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: merchant } = await supabase.from('merchants').select('id').eq('created_by', user.id).maybeSingle();
    setMerchantId(merchant?.id ?? null);
    if (merchant?.id) {
      const { data } = await supabase
        .from('partner_campaigns')
        .select('id, headline, offer_text, accent_color, audience, ends_on, status, authored_by_side, paused_by_side, change_note')
        .eq('merchant_id', merchant.id)
        .neq('status', 'ended')
        .order('created_at', { ascending: false });
      setRows((data as Campaign[]) || []);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: string, decisionNote?: string) => {
    const { error } = await supabase.rpc('partner_campaign_decide', { p_id: id, p_decision: decision, p_note: decisionNote ?? null });
    if (error) { Alert.alert('That did not work', error.message); return; }
    setAskingFor(null);
    setNote('');
    await load();
  };

  const submit = async () => {
    if (!merchantId || headline.trim().length < 3) { Alert.alert('Add a headline', 'Write a short headline first.'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('partner_campaign_save', {
      p_merchant_id: merchantId,
      p_headline: headline,
      p_offer_text: offer || null,
      p_audience: clientsOnly ? 'my_clients' : 'everyone',
    });
    setSaving(false);
    if (error) { Alert.alert('That did not send', error.message); return; }
    setHeadline('');
    setOffer('');
    setClientsOnly(false);
    await load();
  };

  const live = rows.find((r) => r.status === 'live');
  const toApprove = rows.filter((r) => r.status === 'awaiting_business');
  const others = rows.filter((r) => r.status in OTHER_LABEL);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color="#E9F5F3" />
        </TouchableOpacity>
        <Text style={s.title}>Your brand</Text>
        <View style={{ width: 44 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={VOICES.merchant.accent} />
      ) : !merchantId ? (
        <Text style={s.empty}>Only the owner's account can approve the brand.</Text>
      ) : (
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          <Text style={s.lede}>We make it. You approve it. Nothing with your name goes out until you say so.</Text>

          {toApprove.map((c) => (
            <View key={c.id} style={[s.card, glassSurface(0.15), { borderColor: VOICES.merchant.accent, borderWidth: 1 }]}>
              <Text style={s.label}>Waiting for your approval</Text>
              <Preview c={c} />
              {askingFor === c.id ? (
                <>
                  <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="What should we change?" placeholderTextColor="rgba(255,255,255,0.35)" accessibilityLabel="What should we change?" multiline />
                  <TouchableOpacity style={s.primary} accessibilityRole="button" onPress={() => { if (note.trim()) decide(c.id, 'request_changes', note); }}>
                    <Text style={s.primaryText}>Send to G 868</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={s.row}>
                  <TouchableOpacity style={[s.primary, { flex: 1 }]} accessibilityRole="button" onPress={() => decide(c.id, 'approve')}>
                    <Text style={s.primaryText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.secondary, { flex: 1 }]} accessibilityRole="button" onPress={() => setAskingFor(c.id)}>
                    <Text style={s.secondaryText}>Ask for a change</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}

          <View style={[s.card, glassSurface(0.15)]}>
            <Text style={s.label}>On your map pin now</Text>
            {live ? (
              <>
                <Preview c={live} />
                <TouchableOpacity style={s.secondary} accessibilityRole="button" onPress={() => decide(live.id, 'pause')}>
                  <Text style={s.secondaryText}>Pause</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={s.none}>Nothing live yet.</Text>
            )}
          </View>

          {others.map((c) => (
            <View key={c.id} style={[s.card, glassSurface(0.15)]}>
              <Text style={s.label}>{c.status === 'changes_requested' && c.authored_by_side === 'business' ? 'G 868 asked for a change. Send a new package below.' : OTHER_LABEL[c.status]}</Text>
              <Preview c={c} />
              {c.change_note ? <Text style={s.note}>Note: {c.change_note}</Text> : null}
              {c.status === 'paused' && c.paused_by_side === 'business' ? (
                <TouchableOpacity style={s.secondary} accessibilityRole="button" onPress={() => decide(c.id, 'resume')}>
                  <Text style={s.secondaryText}>Put it back on my pin</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}

          <View style={[s.card, glassSurface(0.15)]}>
            <Text style={s.label}>Send us a new package</Text>
            <TextInput style={s.input} value={headline} onChangeText={setHeadline} maxLength={60} placeholder="Headline" placeholderTextColor="rgba(255,255,255,0.35)" accessibilityLabel="Headline" />
            <TextInput style={s.input} value={offer} onChangeText={setOffer} maxLength={140} multiline placeholder="The deal your clients should see" placeholderTextColor="rgba(255,255,255,0.35)" accessibilityLabel="Package" />
            <TouchableOpacity style={s.secondary} accessibilityRole="switch" accessibilityState={{ checked: clientsOnly }} onPress={() => setClientsOnly(!clientsOnly)}>
              <Text style={s.secondaryText}>{clientsOnly ? 'Only my clients see it' : 'Everyone nearby sees it'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primary, saving && { opacity: 0.6 }]} accessibilityRole="button" disabled={saving} onPress={submit}>
              <Text style={s.primaryText}>{saving ? 'Sending…' : 'Send to G 868'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  body: { padding: 20, gap: 14 },
  lede: { fontSize: 14, lineHeight: 20, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  card: { borderRadius: 16, padding: 16, gap: 10 },
  label: { fontSize: 12, fontWeight: '700', color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  preview: { borderRadius: 12, borderLeftWidth: 4, padding: 14 },
  previewHead: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  previewBody: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 2, fontFamily: 'Manrope' },
  previewMeta: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6, fontFamily: 'Manrope' },
  row: { flexDirection: 'row', gap: 10 },
  primary: { minHeight: 44, borderRadius: 12, backgroundColor: VOICES.merchant.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { fontSize: 14, fontWeight: '700', color: '#000', fontFamily: 'Manrope' },
  secondary: { minHeight: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { fontSize: 14, fontWeight: '700', color: '#E9F5F3', fontFamily: 'Manrope' },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', color: '#E9F5F3', paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: 'Manrope' },
  none: { fontSize: 14, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  note: { fontSize: 12, color: '#FCD34D', fontFamily: 'Manrope' },
  empty: { margin: 24, fontSize: 14, color: VOICES.merchant.textMuted, textAlign: 'center', fontFamily: 'Manrope' },
});
