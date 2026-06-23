import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const { supabase } = initializeSupabaseClient('native');

type MerchantStackParamList = {
  Dashboard: undefined;
  Orders: undefined;
  Dispatch: undefined;
  Earnings: undefined;
};

interface DispatchResult {
  ride_id: string;
  ride_pin: string;
  client_name: string;
  pickup_address: string;
  message: string;
}

interface RecentDispatch {
  id: string;
  client_name: string;
  ride_pin: string;
  created_at: string;
  status: string;
}

export function DispatchScreen({ navigation }: { navigation: NativeStackNavigationProp<MerchantStackParamList> }) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [clientPhone, setClientPhone] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [recent, setRecent] = useState<RecentDispatch[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    loadRecent();
  }, []);

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      const { data, error } = await supabase
        .from('rides')
        .select('id, metadata, status, created_at')
        .eq('is_merchant_ride', true)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      setRecent(
        (data || []).map((r: any) => ({
          id: r.id,
          client_name: r.metadata?.guest_name || 'Client',
          ride_pin: r.ride_pin || '—',
          created_at: r.created_at,
          status: r.status,
        }))
      );
    } catch (err: any) {
      console.warn('Failed to load recent dispatches:', err);
      setRecentError(err?.message || 'Could not load dispatch history.');
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleDispatch = async () => {
    const phone = clientPhone.trim();
    if (!phone) {
      Alert.alert('Phone required', 'Enter the client\'s phone number.');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('merchant', {
        body: { action: 'dispatch_client', client_phone: phone, note: note.trim() || undefined },
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Dispatch failed', data?.error || 'Unknown error');
        return;
      }

      setResult(data);
      setClientPhone('');
      setNote('');
      loadRecent();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not dispatch ride');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const statusColor = (s: string) => {
    if (s === 'completed') return '#4ADE80';
    if (s === 'cancelled') return '#EF4444';
    if (s === 'in_progress') return '#60A5FA';
    return VOICES.merchant.accent;
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.container, { paddingTop: insets.top }]}>
        <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} accessibilityLabel="Go back" accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={s.title}>Send a Car</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[s.card, glassSurface(0.15)]}>
            <Text style={s.cardTitle}>Client Details</Text>
            <Text style={s.label}>Phone Number</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="call-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="+1 868 xxx xxxx"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={clientPhone}
                onChangeText={setClientPhone}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
            <Text style={s.label}>Note (optional)</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="chatbubble-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="e.g. Cutting done, ready in 5 min"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
              />
            </View>

            <TouchableOpacity
              style={[s.dispatchBtn, loading && s.dispatchBtnDisabled]}
              onPress={handleDispatch}
              disabled={loading}
              accessibilityLabel="Dispatch a car to the client"
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="car-sport" size={20} color="#000" style={{ marginRight: 8 }} />
                  <Text style={s.dispatchBtnText}>Dispatch Car</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {result && (
            <View style={[s.resultCard, glassSurface(0.2)]}>
              <View style={s.resultHeader}>
                <Ionicons name="checkmark-circle" size={28} color="#4ADE80" />
                <Text style={s.resultTitle}>Car on the way!</Text>
              </View>
              <Text style={s.resultLine}>Client: <Text style={s.resultValue}>{result.client_name}</Text></Text>
              <Text style={s.resultLine}>Pickup: <Text style={s.resultValue}>{result.pickup_address}</Text></Text>
              <View style={s.pinRow}>
                <Text style={s.resultLine}>PIN: </Text>
                <View style={s.pinBadge}>
                  <Text style={s.pinText}>{result.ride_pin}</Text>
                </View>
              </View>
              <Text style={s.resultNote}>{result.message}</Text>
            </View>
          )}

          <Text style={s.sectionTitle}>Recent Dispatches</Text>
          {loadingRecent ? (
            <ActivityIndicator color={VOICES.merchant.accent} style={{ marginTop: 16 }} />
          ) : recentError ? (
            <Text style={[s.emptyText, { color: '#EF4444' }]}>{recentError}</Text>
          ) : recent.length === 0 ? (
            <Text style={s.emptyText}>No dispatches yet.</Text>
          ) : (
            recent.map((r) => (
              <View key={r.id} style={[s.recentRow, glassSurface(0.10)]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.recentName}>{r.client_name}</Text>
                  <Text style={s.recentTime}>{formatTime(r.created_at)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[s.statusBadge, { backgroundColor: statusColor(r.status) + '26' }]}>
                    <Text style={[s.statusText, { color: statusColor(r.status) }]}>{r.status}</Text>
                  </View>
                  <Text style={s.pinSmall}>PIN {r.ride_pin}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', fontFamily: 'SpaceGrotesk' },
  scrollContent: { padding: 20, paddingBottom: 60 },
  card: { borderRadius: 20, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 16, fontFamily: 'SpaceGrotesk' },
  label: { fontSize: 12, color: VOICES.merchant.textMuted, marginBottom: 6, fontFamily: 'Manrope', letterSpacing: 0.5, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 16 },
  input: { flex: 1, fontSize: 15, color: '#FFFFFF', fontFamily: 'Manrope' },
  dispatchBtn: { backgroundColor: VOICES.merchant.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  dispatchBtnDisabled: { opacity: 0.5 },
  dispatchBtnText: { fontSize: 16, fontWeight: '700', color: '#000', fontFamily: 'SpaceGrotesk' },
  resultCard: { borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#4ADE8030' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  resultTitle: { fontSize: 18, fontWeight: '700', color: '#4ADE80', fontFamily: 'SpaceGrotesk' },
  resultLine: { fontSize: 14, color: VOICES.merchant.textMuted, marginBottom: 4, fontFamily: 'Manrope' },
  resultValue: { color: '#FFFFFF', fontWeight: '600' },
  pinRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  pinBadge: { backgroundColor: VOICES.merchant.accent + '26', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  pinText: { fontSize: 18, fontWeight: '800', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk', letterSpacing: 2 },
  resultNote: { fontSize: 13, color: VOICES.merchant.textMuted, marginTop: 8, fontFamily: 'Manrope', fontStyle: 'italic' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 12, fontFamily: 'SpaceGrotesk' },
  emptyText: { fontSize: 14, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', textAlign: 'center', marginTop: 16 },
  recentRow: { flexDirection: 'row', borderRadius: 14, padding: 14, marginBottom: 8 },
  recentName: { fontSize: 14, fontWeight: '600', color: '#FFFFFF', fontFamily: 'SpaceGrotesk' },
  recentTime: { fontSize: 12, color: VOICES.merchant.textMuted, marginTop: 2, fontFamily: 'Manrope' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700', fontFamily: 'Manrope', textTransform: 'capitalize' },
  pinSmall: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
});
