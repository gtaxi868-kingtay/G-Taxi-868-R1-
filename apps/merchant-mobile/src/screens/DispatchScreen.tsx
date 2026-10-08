import React, { useState, useEffect, useCallback } from 'react';
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
  dropoff_address: string;
  vehicle_label: string;
  fare_cents: number;
  message: string;
}

interface RecentDispatch {
  id: string;
  client_name: string;
  ride_pin: string;
  created_at: string;
  status: string;
  vehicle_type: string;
  fare_cents: number;
  dropoff_address: string;
}

interface VehicleOption { key: string; label: string }

// Passenger classes only — heavy vehicles are never offered from a counter.
const PASSENGER_KEYS = ['standard', 'xl', 'premium'];
const FALLBACK_VEHICLES: VehicleOption[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'xl', label: 'XL' },
  { key: 'premium', label: 'Premium' },
];

const fmtTTD = (cents: number) => `TT$${(cents / 100).toFixed(2)}`;

export function DispatchScreen({ navigation }: { navigation: NativeStackNavigationProp<MerchantStackParamList> }) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [clientPhone, setClientPhone] = useState('');
  const [guestName, setGuestName] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [vehicles, setVehicles] = useState<VehicleOption[]>(FALLBACK_VEHICLES);
  const [vehicle, setVehicle] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [recent, setRecent] = useState<RecentDispatch[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  const authHeaders = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : undefined;

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    setRecentError(null);
    try {
      const { data, error } = await supabase.functions.invoke('merchant', {
        body: { action: 'list_dispatches' },
        headers: authHeaders,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not load dispatch history.');
      setRecent(data.dispatches || []);
    } catch (err: any) {
      setRecentError(err?.message || 'Could not load dispatch history.');
    } finally {
      setLoadingRecent(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    loadRecent();
    supabase
      .from('vehicle_classes')
      .select('key, label')
      .eq('is_active', true)
      .in('key', PASSENGER_KEYS)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length) setVehicles(data as VehicleOption[]);
      }, () => {});
  }, [loadRecent]);

  const handleDispatch = async () => {
    const phone = clientPhone.trim();
    const dest = destination.trim();
    if (!phone) {
      Alert.alert('Phone required', "Enter the client's phone number.");
      return;
    }
    if (!dest) {
      Alert.alert('Destination required', 'Where is the client going? We need it to quote the fare.');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('merchant', {
        body: {
          action: 'dispatch_client',
          client_phone: phone,
          guest_name: guestName.trim() || undefined,
          dropoff_address: dest,
          vehicle_type: vehicle,
          note: note.trim() || undefined,
        },
        headers: authHeaders,
      });

      if (error) throw error;
      if (!data?.success) {
        Alert.alert('Could not send the car', data?.error || 'Unknown error');
        return;
      }

      setResult(data);
      setClientPhone('');
      setGuestName('');
      setDestination('');
      setNote('');
      loadRecent();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not send the car');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const statusColor = (st: string) => {
    if (st === 'completed') return '#4ADE80';
    if (st === 'cancelled') return '#EF4444';
    if (st === 'in_progress') return '#60A5FA';
    return VOICES.merchant.accent;
  };

  const vehicleLabel = (key: string) =>
    vehicles.find((v) => v.key === key)?.label ?? key;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.container, { paddingTop: insets.top }]}>
        <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} accessibilityLabel="Go back" accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color="#E9F5F3" />
          </TouchableOpacity>
          <Text style={s.title}>Send a car</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[s.card, glassSurface(0.15)]}>
            <Text style={s.cardTitle}>Who's riding</Text>

            <Text style={s.label}>Client phone</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="call-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="868 xxx xxxx"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={clientPhone}
                onChangeText={setClientPhone}
                keyboardType="phone-pad"
                returnKeyType="next"
              />
            </View>

            <Text style={s.label}>Client name (optional)</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="person-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="So the driver knows who to ask for"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={guestName}
                onChangeText={setGuestName}
                returnKeyType="next"
              />
            </View>

            <Text style={s.label}>Going to</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="location-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="Address or landmark, e.g. Hyatt Regency POS"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={destination}
                onChangeText={setDestination}
                returnKeyType="done"
              />
            </View>

            <Text style={s.label}>Vehicle</Text>
            <View style={s.vehicleRow}>
              {vehicles.map((v) => {
                const active = v.key === vehicle;
                return (
                  <TouchableOpacity
                    key={v.key}
                    onPress={() => setVehicle(v.key)}
                    style={[s.vehicleChip, active && s.vehicleChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[s.vehicleChipText, active && s.vehicleChipTextActive]}>{v.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.label}>Note for the driver (optional)</Text>
            <View style={[s.inputRow, ghostBorder(0.2)]}>
              <Ionicons name="chatbubble-outline" size={18} color={VOICES.merchant.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={s.input}
                placeholder="e.g. Ready in 5 min, side entrance"
                placeholderTextColor={VOICES.merchant.textMuted}
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
              />
            </View>

            <Text style={s.payNote}>The client pays the driver for the ride. Your business is never charged.</Text>

            <TouchableOpacity
              style={[s.dispatchBtn, loading && s.dispatchBtnDisabled]}
              onPress={handleDispatch}
              disabled={loading}
              accessibilityLabel="Send a car to the client"
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="car-sport" size={20} color="#000" style={{ marginRight: 8 }} />
                  <Text style={s.dispatchBtnText}>Send the car</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {result && (
            <View style={[s.resultCard, glassSurface(0.2)]}>
              <View style={s.resultHeader}>
                <Ionicons name="checkmark-circle" size={28} color="#4ADE80" />
                <Text style={s.resultTitle}>Car on the way</Text>
              </View>
              <Text style={s.resultLine}>Client: <Text style={s.resultValue}>{result.client_name}</Text></Text>
              <Text style={s.resultLine}>Vehicle: <Text style={s.resultValue}>{result.vehicle_label}</Text></Text>
              <Text style={s.resultLine}>To: <Text style={s.resultValue}>{result.dropoff_address}</Text></Text>
              <Text style={s.resultLine}>Fare: <Text style={s.resultValue}>about {fmtTTD(result.fare_cents)}, paid to the driver</Text></Text>
              <View style={s.pinRow}>
                <Text style={s.resultLine}>PIN: </Text>
                <View style={s.pinBadge}>
                  <Text style={s.pinText}>{result.ride_pin}</Text>
                </View>
              </View>
              <Text style={s.resultNote}>{result.message}</Text>
            </View>
          )}

          <Text style={s.sectionTitle}>Recent cars sent</Text>
          {loadingRecent ? (
            <ActivityIndicator color={VOICES.merchant.accent} style={{ marginTop: 16 }} />
          ) : recentError ? (
            <Text style={[s.emptyText, { color: '#EF4444' }]}>{recentError}</Text>
          ) : recent.length === 0 ? (
            <Text style={s.emptyText}>No cars sent yet.</Text>
          ) : (
            recent.map((r) => (
              <View key={r.id} style={[s.recentRow, glassSurface(0.10)]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={s.recentName}>{r.client_name}</Text>
                  <Text style={s.recentTime} numberOfLines={1}>
                    {formatTime(r.created_at)} · {vehicleLabel(r.vehicle_type)} · {r.dropoff_address}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[s.statusBadge, { backgroundColor: statusColor(r.status) + '26' }]}>
                    <Text style={[s.statusText, { color: statusColor(r.status) }]}>{r.status.replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={s.pinSmall}>{fmtTTD(r.fare_cents || 0)} · PIN {r.ride_pin}</Text>
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
  title: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  scrollContent: { padding: 20, paddingBottom: 60 },
  card: { borderRadius: 20, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', marginBottom: 16, fontFamily: 'SpaceGrotesk' },
  label: { fontSize: 12, color: VOICES.merchant.textMuted, marginBottom: 6, fontFamily: 'Manrope', letterSpacing: 0.5, textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 16 },
  input: { flex: 1, fontSize: 15, color: '#E9F5F3', fontFamily: 'Manrope' },
  vehicleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  vehicleChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  vehicleChipActive: { backgroundColor: VOICES.merchant.accent + '26', borderColor: VOICES.merchant.accent },
  vehicleChipText: { fontSize: 14, fontWeight: '600', color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
  vehicleChipTextActive: { color: '#E9F5F3' },
  payNote: { fontSize: 12.5, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', marginBottom: 14, lineHeight: 18 },
  dispatchBtn: { backgroundColor: VOICES.merchant.accent, borderRadius: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  dispatchBtnDisabled: { opacity: 0.5 },
  dispatchBtnText: { fontSize: 16, fontWeight: '700', color: '#000', fontFamily: 'SpaceGrotesk' },
  resultCard: { borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#4ADE8030' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  resultTitle: { fontSize: 18, fontWeight: '700', color: '#4ADE80', fontFamily: 'SpaceGrotesk' },
  resultLine: { fontSize: 14, color: VOICES.merchant.textMuted, marginBottom: 4, fontFamily: 'Manrope' },
  resultValue: { color: '#E9F5F3', fontWeight: '600' },
  pinRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  pinBadge: { backgroundColor: VOICES.merchant.accent + '26', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  pinText: { fontSize: 18, fontWeight: '800', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk', letterSpacing: 2 },
  resultNote: { fontSize: 13, color: VOICES.merchant.textMuted, marginTop: 8, fontFamily: 'Manrope' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#E9F5F3', marginBottom: 12, fontFamily: 'SpaceGrotesk' },
  emptyText: { fontSize: 14, color: VOICES.merchant.textMuted, fontFamily: 'Manrope', textAlign: 'center', marginTop: 16 },
  recentRow: { flexDirection: 'row', borderRadius: 14, padding: 14, marginBottom: 8 },
  recentName: { fontSize: 14, fontWeight: '600', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  recentTime: { fontSize: 12, color: VOICES.merchant.textMuted, marginTop: 2, fontFamily: 'Manrope' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700', fontFamily: 'Manrope', textTransform: 'capitalize' },
  pinSmall: { fontSize: 11, color: VOICES.merchant.textMuted, fontFamily: 'Manrope' },
});
