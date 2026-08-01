import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;
const GREEN = '#10B981';
const RED = '#EF4444';

// Mobile mirror of apps/admin/src/pages/Approvals.tsx — same RPC, same
// execute-on-approve call. G files proposals here; nothing runs until
// an admin approves.
interface Proposal {
  id: string;
  department: string;
  action_type: string;
  title: string;
  reasoning: string;
  category: 'money' | 'people' | 'public' | 'config' | 'other';
  amount_cents: number | null;
  created_at: string;
}

const CATEGORY_COLOR: Record<Proposal['category'], string> = {
  money: '#F59E0B',
  people: '#3B82F6',
  public: '#EC4899',
  config: '#8B5CF6',
  other: '#6B7280',
};

function ttd(cents: number | null): string | null {
  if (cents == null) return null;
  return `TTD $${(cents / 100).toFixed(2)}`;
}

export function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('g_proposed_actions')
      .select('id, department, action_type, title, reasoning, category, amount_cents, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error) setPending((data as Proposal[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('g_decide_action', { p_id: id, p_decision: decision });
      if (error) throw error;
      if (decision === 'approved') {
        supabase.functions.invoke('g_execute_action', { body: { proposal_id: id } }).then(null, () => null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record decision';
      Alert.alert('Error', message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading inbox...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <View style={styles.header}>
        <Ionicons name="file-tray-full-outline" size={20} color={ACCENT} />
        <Text style={styles.headerText}>{pending.length} awaiting your decision</Text>
      </View>

      {pending.length === 0 && (
        <GlassContainer style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Inbox zero</Text>
          <Text style={styles.emptyDesc}>G has nothing waiting on you right now.</Text>
        </GlassContainer>
      )}

      {pending.map((p) => (
        <GlassContainer key={p.id} style={styles.card}>
          <View style={styles.tagsRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{p.department}</Text>
            </View>
            <Text style={styles.actionType}>{p.action_type}</Text>
            {p.amount_cents != null && (
              <Text style={[styles.amount, { color: CATEGORY_COLOR.money }]}>{ttd(p.amount_cents)}</Text>
            )}
          </View>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.reasoning}>{p.reasoning}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              disabled={busyId === p.id}
              onPress={() => decide(p.id, 'approved')}
              style={[styles.btn, { backgroundColor: `${GREEN}25` }]}
            >
              {busyId === p.id ? (
                <ActivityIndicator size="small" color={GREEN} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color={GREEN} />
                  <Text style={[styles.btnText, { color: GREEN }]}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              disabled={busyId === p.id}
              onPress={() => decide(p.id, 'rejected')}
              style={[styles.btn, styles.btnGhost]}
            >
              <Ionicons name="close" size={16} color={RED} />
              <Text style={[styles.btnText, { color: RED }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        </GlassContainer>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  headerText: { color: '#F1F5F9', fontSize: 15, fontWeight: '700' },
  emptyCard: { alignItems: 'center', paddingVertical: 24 },
  emptyTitle: { color: '#F1F5F9', fontSize: 14, fontWeight: '700' },
  emptyDesc: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4, textAlign: 'center' },
  card: { marginBottom: 12 },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tag: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  actionType: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600' },
  amount: { fontSize: 11, fontWeight: '800', marginLeft: 'auto' },
  title: { color: '#F1F5F9', fontSize: 14, fontWeight: '700', marginTop: 8 },
  reasoning: { color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.05)' },
  btnText: { fontSize: 12, fontWeight: '700' },
});
