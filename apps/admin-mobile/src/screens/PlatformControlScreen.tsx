// Platform Control, mobile parity with the web admin page.
//
// Same two tables, same rules, same wording. An operator must not have to
// remember which switches exist "on the laptop version" — a switch that
// appears on one and not the other is how you end up trusting neither.
//
// The web page (apps/admin/src/pages/PlatformControl.tsx) is the reference.
// If you wire a flag there, add it to FLAG_WIRING here too.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView, Text, StyleSheet, View, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

interface Vertical {
  id: string;
  vertical_name: string;
  display_name: string;
  is_enabled: boolean;
  rollout_percentage: number;
}

interface FeatureFlag {
  id: string;
  is_active: boolean;
  description: string | null;
}

// Kept identical to the web page on purpose.
const FLAG_WIRING: Record<string, string> = {
  kiosk_active: 'Rider home: NFC Tap tile',
  carnival_active: 'Rider home: Carnival tile',
  events_active: 'Rider home: Events tile',
  ai_assistant_active: 'Rider home: voice / G assistant',
  opt_in_ai_routing: 'Rider settings: AI Route Opt-In row',
  promo_codes_active: 'Rider: promo code entry',
  airline_active: 'Rider: G-Escape flight packages',
  hotel_active: 'Rider: G-Escape packages that include lodging',
  driver_registration_active: 'Driver app: registration',
  merchant_billing_enabled: 'Admin: merchant billing',
  merchant_commission_enabled: 'Payouts: merchant kiosk commission (server-side)',
};

const PLANNED_NOTE: Record<string, string> = {
  scheduled_rides_enabled: 'Planned — the scheduling engine is not built yet.',
};

export function PlatformControlScreen() {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // .then(ok, err): a Supabase query builder is a thenable with no .catch.
    const [vRes, fRes] = await Promise.all([
      supabase.from('vertical_settings').select('*').order('sort_order')
        .then((r: any) => r, (e: any) => ({ data: null, error: e })),
      supabase.from('system_feature_flags').select('*').order('id')
        .then((r: any) => r, (e: any) => ({ data: null, error: e })),
    ]);
    setVerticals((vRes.data as Vertical[]) ?? []);
    setFlags((fRes.data as FeatureFlag[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFlag = async (f: FeatureFlag) => {
    setBusy(f.id);
    const next = !f.is_active;
    const { error } = await supabase
      .rpc('admin_toggle_feature_flag', { p_id: f.id, p_is_active: next })
      .then((r: any) => r, (e: any) => ({ error: e }));
    setBusy(null);

    // admin_toggle_feature_flag raises on an unknown id rather than silently
    // matching zero rows, so a failure here is real and must be shown.
    if (error) {
      Alert.alert('Could not change that switch', String((error as any).message ?? error));
      return;
    }
    setFlags(prev => prev.map(x => (x.id === f.id ? { ...x, is_active: next } : x)));
  };

  const toggleVertical = async (v: Vertical) => {
    setBusy(v.id);
    const next = !v.is_enabled;
    const { error } = await supabase
      .rpc('admin_update_vertical', { p_id: v.id, p_is_enabled: next, p_rollout: next ? 100 : 0 })
      .then((r: any) => r, (e: any) => ({ error: e }));
    setBusy(null);

    if (error) {
      Alert.alert(`Could not change ${v.display_name}`, String((error as any).message ?? error));
      return;
    }
    await load();
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={ACCENT}
        />
      }
    >
      <Text style={styles.title}>Platform Control</Text>

      <Text style={styles.sectionLabel}>VERTICALS</Text>
      <Text style={styles.sectionHint}>
        Which services riders can see. Enforced on the server, so switching one
        off reaches phones that are already open.
      </Text>
      {verticals.map(v => (
        <GlassContainer key={v.id} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.itemTitle}>{v.display_name}</Text>
              <Text style={styles.itemMeta}>
                {v.vertical_name} · rollout {v.rollout_percentage}%
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.pill, v.is_enabled ? styles.pillOn : styles.pillOff]}
              onPress={() => toggleVertical(v)}
              disabled={busy === v.id}
              accessibilityRole="button"
              accessibilityLabel={`${v.display_name} is ${v.is_enabled ? 'on' : 'off'}. Tap to change.`}
            >
              {busy === v.id
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.pillText}>{v.is_enabled ? 'ON' : 'OFF'}</Text>}
            </TouchableOpacity>
          </View>
        </GlassContainer>
      ))}

      <Text style={styles.sectionLabel}>PLATFORM SWITCHES</Text>
      <Text style={styles.sectionHint}>
        Behaviour inside the services. Green says what a switch controls.
      </Text>
      {flags.map(f => {
        const wired = FLAG_WIRING[f.id];
        return (
          <GlassContainer key={f.id} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.itemTitle, !f.is_active && styles.dim]}>{f.id}</Text>
                {!!f.description && <Text style={styles.itemMeta}>{f.description}</Text>}
                <Text style={wired ? styles.wired : styles.planned}>
                  {wired
                    ? `Controls: ${wired}`
                    : (PLANNED_NOTE[f.id] ?? 'Not wired yet — toggling this changes nothing.')}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.pill, f.is_active ? styles.pillOn : styles.pillOff]}
                onPress={() => toggleFlag(f)}
                disabled={busy === f.id}
                accessibilityRole="button"
                accessibilityLabel={`${f.id} is ${f.is_active ? 'on' : 'off'}. Tap to change.`}
              >
                {busy === f.id
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.pillText}>{f.is_active ? 'ON' : 'OFF'}</Text>}
              </TouchableOpacity>
            </View>
          </GlassContainer>
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, padding: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 20, marginTop: 40 },
  sectionLabel: {
    color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '800',
    letterSpacing: 2, marginTop: 12, marginBottom: 4,
  },
  sectionHint: { color: 'rgba(255,255,255,0.35)', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  itemTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dim: { color: 'rgba(255,255,255,0.4)' },
  itemMeta: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  wired: { color: '#34D399', fontSize: 11, marginTop: 4 },
  planned: { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 4 },
  pill: { minWidth: 62, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center' },
  pillOn: { backgroundColor: ACCENT },
  pillOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
});
