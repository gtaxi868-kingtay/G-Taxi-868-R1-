import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, ScrollView, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../navigation/types';
import { initializeSupabaseClient } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');

type NavProp = NativeStackNavigationProp<AppStackParamList, 'IssueKeychain'>;

const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

interface Rider {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
}

// Writes the other half of what merchant_nfc_charge / rider_nfc_pay have
// been able to read all along: an identity_tags row binding one physical
// NFC fob to one rider's account. Confirmed live before building this: 0
// rows existed in identity_tags, and no RLS policy lets any role but
// service_role insert one -- so this has to go through the admin edge
// function (issue_identity_tag), same as every other admin-only write in
// this app, not a direct client insert.
export function IssueKeychainScreen({ navigation }: { navigation: NavProp }) {
  const insets = useSafeAreaInsets();

  const [tagUid, setTagUid] = useState('');
  const [scanning, setScanning] = useState(false);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Rider[]>([]);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    NfcManager.start();
  }, []);

  const scanTag = async () => {
    setScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await NfcManager.requestTechnology(NfcTech.NfcA);
      const tag = await NfcManager.getTag();
      if (tag?.id) {
        setTagUid(tag.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        throw new Error('Could not read the tag. Hold the fob steady against the phone.');
      }
      await NfcManager.cancelTechnologyRequest();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Scan Failed', err?.message || 'Could not read the tag.');
    } finally {
      setScanning(false);
    }
  };

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action: 'search_riders', q: q.trim() },
      });
      if (error) throw error;
      setResults(data?.riders || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const issue = async (replaceExisting = false) => {
    if (!tagUid.trim() || !selectedRider) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: {
          action: 'issue_identity_tag',
          tag_uid: tagUid.trim(),
          profile_id: selectedRider.id,
          replace_existing: replaceExisting,
        },
      });
      if (error) throw error;

      if (!data?.success) {
        // Rider already has a live tag -- ask before deactivating it.
        if (data?.error?.includes('already has an active tag') && !replaceExisting) {
          Alert.alert(
            'Rider Already Has a Tag',
            `${selectedRider.full_name || 'This rider'} already has an active keychain. Issuing a new one will deactivate the old one.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Replace It', onPress: () => issue(true) },
            ],
          );
          return;
        }
        throw new Error(data?.error || 'Failed to issue tag');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Keychain Issued',
        `Tag ${tagUid.trim()} is now bound to ${data.rider_name || selectedRider.full_name}.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed to Issue Tag', err?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = tagUid.trim().length > 0 && !!selectedRider && !submitting;

  return (
    <LinearGradient colors={[BG, '#0B1120']} style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Issue Keychain</Text>
          <View style={{ width: 34 }} />
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>1. SCAN THE BLANK FOB</Text>
        <View style={styles.tagRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <TextInput
              style={styles.input}
              placeholder="Scan or type tag UID"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={tagUid}
              onChangeText={setTagUid}
              autoCapitalize="characters"
            />
          </View>
          <TouchableOpacity
            style={[styles.scanBtn, scanning && { opacity: 0.6 }]}
            onPress={scanTag}
            disabled={scanning}
          >
            {scanning ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="scan" size={18} color="#FFF" />}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>2. FIND THE RIDER</Text>
        {selectedRider ? (
          <View style={styles.selectedRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{selectedRider.full_name || 'Unnamed'}</Text>
              <Text style={styles.selectedMeta}>{selectedRider.phone_number || selectedRider.email || selectedRider.id}</Text>
            </View>
            <TouchableOpacity onPress={() => { setSelectedRider(null); setQuery(''); }} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Search name, phone, or email"
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
              {searching && <ActivityIndicator size="small" color={ACCENT} />}
            </View>
            {results.length > 0 && (
              <View style={styles.resultsBox}>
                {results.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.resultRow}
                    onPress={() => { setSelectedRider(r); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Text style={styles.resultName}>{r.full_name || 'Unnamed'}</Text>
                    <Text style={styles.resultMeta}>{r.phone_number || r.email}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
          onPress={() => issue(false)}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="key" size={18} color="#FFF" />
              <Text style={styles.submitText}>Issue Keychain</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Once issued, this rider pays by tapping their fob on a merchant's phone,
          or by tapping their own phone at any G-Taxi touchpoint.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerPad: { paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#F1F5F9' },
  body: { flex: 1, paddingHorizontal: 20 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.25)', letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },
  tagRow: { flexDirection: 'row', gap: 8 },
  inputGroup: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  input: { flex: 1, color: '#F1F5F9', fontSize: 14 },
  scanBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: `${ACCENT}50`,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: `${ACCENT}30`,
  },
  resultsBox: { marginTop: 8, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  resultRow: { padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  resultName: { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  resultMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
  selectedRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16,185,129,0.08)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)', borderRadius: 12, padding: 14,
  },
  selectedName: { color: '#F1F5F9', fontSize: 15, fontWeight: '700' },
  selectedMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  clearBtn: { padding: 4 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: 12, backgroundColor: ACCENT, marginTop: 24,
  },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 16, marginTop: 12, textAlign: 'center' },
});
