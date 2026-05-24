import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { LocationAccuracy } from 'expo-location';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

type RootStackParamList = {
  Dashboard: undefined;
  TagMarker: undefined;
};

type TagMarkerNavProp = NativeStackNavigationProp<RootStackParamList, 'TagMarker'>;

type SpotType = 'business' | 'taxi_stand';

export function TagMarkerScreen({ navigation }: { navigation: TagMarkerNavProp }) {
  const insets = useSafeAreaInsets();
  const [spotType, setSpotType] = useState<SpotType>('business');

  const [tagUid, setTagUid] = useState('');
  const [locationName, setLocationName] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [merchantEmail, setMerchantEmail] = useState('');
  const [merchantPassword, setMerchantPassword] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'acquired' | 'failed'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [nfcScanning, setNfcScanning] = useState(false);

  useEffect(() => {
    NfcManager.start();
  }, []);

  const scanNfcTag = async () => {
    setNfcScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await NfcManager.requestTechnology(NfcTech.NfcA);
      const tag = await NfcManager.getTag();
      if (tag?.id) {
        setTagUid(tag.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      NfcManager.setAlertMessage('Tag UID captured');
      await NfcManager.cancelTechnologyRequest();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setNfcScanning(false);
    }
  };

  const captureGps = async () => {
    setGpsStatus('acquiring');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'GPS access is required to register a taxi stand location.');
        setGpsStatus('failed');
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: LocationAccuracy.High,
      });

      if (loc.coords.accuracy && loc.coords.accuracy > 50) {
        Alert.alert(
          'Low GPS Accuracy',
          `Current accuracy is ${Math.round(loc.coords.accuracy)}m. Map picker will open for manual placement.`,
          [
            { text: 'Retry', onPress: () => captureGps() },
            { text: 'Open Map Picker', onPress: () => openMapPicker(loc.coords.latitude, loc.coords.longitude) },
          ]
        );
      }

      setLat(loc.coords.latitude);
      setLng(loc.coords.longitude);
      setGpsStatus('acquired');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setGpsStatus('failed');
      Alert.alert(
        'GPS Failed',
        'Could not acquire GPS lock. Open map picker to place the pin manually.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Map Picker', onPress: () => openMapPicker() },
        ]
      );
    }
  };

  const openMapPicker = (fallbackLat?: number, fallbackLng?: number) => {
    Alert.alert('Map Picker', 'Map-based pin placement will open here. For now, enter coordinates manually.', [
      { text: 'OK' },
    ]);
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 12; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setMerchantPassword(pwd);
  };

  useEffect(() => {
    if (!merchantPassword) generatePassword();
  }, [merchantPassword]);

  const handleSubmit = async () => {
    if (!tagUid.trim()) {
      Alert.alert('Missing Tag UID', 'Scan or enter the NFC tag UID before provisioning.');
      return;
    }
    if (!locationName.trim()) {
      Alert.alert('Missing Location', 'Enter a location name for this node.');
      return;
    }

    if (spotType === 'business') {
      if (!merchantName.trim()) {
        Alert.alert('Missing Business Name', 'Enter the business name.');
        return;
      }
      if (!merchantEmail.trim()) {
        Alert.alert('Missing Email', 'Enter the merchant owner email.');
        return;
      }
    }

    if (spotType === 'taxi_stand' && !lat && !lng) {
      Alert.alert('Missing Location', 'Capture GPS coordinates or drop a pin for this taxi stand.');
      return;
    }

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      if (spotType === 'business') {
        const { data: merchantResult, error: merchantError } = await supabase.functions.invoke(
          'admin_create_merchant_user',
          { body: { email: merchantEmail.trim(), password: merchantPassword, full_name: merchantName.trim() } }
        );

        if (merchantError || !merchantResult?.success) {
          throw new Error(merchantResult?.error || merchantError?.message || 'Failed to create merchant user');
        }

        const { data: nodeResult, error: nodeError } = await supabase.functions.invoke(
          'admin_manage_nodes',
          {
            body: {
              action: 'upsert',
              node: {
                tag_uid: tagUid.trim(),
                merchant_id: merchantResult.merchant_id,
                location_name: locationName.trim(),
                lat: lat,
                lng: lng,
                default_services: ['ride', 'grocery'],
              },
            },
          }
        );

        if (nodeError || !nodeResult?.success) {
          throw new Error(nodeResult?.error || nodeError?.message || 'Failed to upsert node');
        }

        Alert.alert(
          'Business Spot Provisioned',
          `Merchant: ${merchantName.trim()}\nEmail: ${merchantEmail.trim()}\nPassword: ${merchantPassword}\nTag: ${tagUid.trim()}\n\nSave these credentials. Share them with the merchant owner.`,
          [{ text: 'Done', onPress: () => navigation.goBack() }]
        );
      } else {
        const { data: nodeResult, error: nodeError } = await supabase.functions.invoke(
          'admin_manage_nodes',
          {
            body: {
              action: 'upsert',
              node: {
                tag_uid: tagUid.trim(),
                merchant_id: null,
                location_name: locationName.trim(),
                lat: lat,
                lng: lng,
                default_services: ['ride'],
              },
            },
          }
        );

        if (nodeError || !nodeResult?.success) {
          throw new Error(nodeResult?.error || nodeError?.message || 'Failed to upsert node');
        }

        Alert.alert(
          'Taxi Stand Provisioned',
          `Location: ${locationName.trim()}\nGPS: ${lat?.toFixed(5)}, ${lng?.toFixed(5)}\nTag: ${tagUid.trim()}`,
          [{ text: 'Done', onPress: () => navigation.goBack() }]
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = err instanceof Error ? err.message : 'An error occurred';
      Alert.alert('Provisioning Failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={[SURFACE.base, '#1A0A0A']} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Provision Puck</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.typeSplitter}>
        <TouchableOpacity
          style={[styles.typeTile, spotType === 'business' && styles.typeTileActive]}
          onPress={() => { setSpotType('business'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          activeOpacity={0.85}
        >
          <View style={[styles.typeTileBg, glassSurface(spotType === 'business' ? 30 : 10)]}>
            <Ionicons name="storefront" size={28} color={spotType === 'business' ? '#F59E0B' : 'rgba(255,255,255,0.3)'} />
            <Text style={[styles.typeTileLabel, spotType === 'business' && styles.typeTileLabelActive]}>Business Spot</Text>
            <Text style={styles.typeTileDesc}>Link to a merchant</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.typeTile, spotType === 'taxi_stand' && styles.typeTileActive]}
          onPress={() => { setSpotType('taxi_stand'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          activeOpacity={0.85}
        >
          <View style={[styles.typeTileBg, glassSurface(spotType === 'taxi_stand' ? 30 : 10)]}>
            <Ionicons name="car" size={28} color={spotType === 'taxi_stand' ? '#06B6D4' : 'rgba(255,255,255,0.3)'} />
            <Text style={[styles.typeTileLabel, spotType === 'taxi_stand' && styles.typeTileLabelActive]}>Taxi Stand</Text>
            <Text style={styles.typeTileDesc}>Public H-plate stop</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionLabel}>TAG IDENTIFIER</Text>
        <View style={styles.tagRow}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <TextInput
              style={styles.input}
              placeholder="Scan or type tag UID"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={tagUid}
              onChangeText={setTagUid}
              autoCapitalize="characters"
            />
          </View>
          <TouchableOpacity
            style={[styles.scanBtn, nfcScanning && styles.scanBtnActive]}
            onPress={scanNfcTag}
            disabled={nfcScanning}
          >
            {nfcScanning ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="scan" size={20} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>LOCATION NAME</Text>
        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            placeholder="e.g. KFC South Entrance"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={locationName}
            onChangeText={setLocationName}
          />
        </View>

        {spotType === 'business' ? (
          <>
            <Text style={styles.sectionLabel}>BUSINESS DETAILS</Text>
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Business name"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={merchantName}
                onChangeText={setMerchantName}
              />
            </View>
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Owner email"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={merchantEmail}
                onChangeText={setMerchantEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.passwordRow}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <TextInput
                  style={[styles.input, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 }]}
                  placeholder="Auto-generated password"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={merchantPassword}
                  onChangeText={setMerchantPassword}
                  autoCapitalize="none"
                />
              </View>
              <TouchableOpacity style={styles.regenerateBtn} onPress={generatePassword}>
                <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              An auth account + merchant profile will be created for the business owner.
            </Text>

            <Text style={styles.sectionLabel}>GPS (optional for business)</Text>
            <TouchableOpacity style={styles.gpsBtn} onPress={captureGps}>
              <Ionicons
                name={gpsStatus === 'acquired' ? 'checkmark-circle' : 'locate'}
                size={18}
                color={gpsStatus === 'acquired' ? '#10B981' : 'rgba(255,255,255,0.5)'}
              />
              <Text style={styles.gpsBtnText}>
                {gpsStatus === 'idle' ? 'Capture Current Location' :
                 gpsStatus === 'acquiring' ? 'Acquiring GPS...' :
                 gpsStatus === 'acquired' ? `${lat?.toFixed(5)}, ${lng?.toFixed(5)}` :
                 'GPS Failed — Tap to retry'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>GPS COORDINATES (REQUIRED)</Text>
            <TouchableOpacity
              style={[styles.gpsBtn, gpsStatus === 'acquired' && styles.gpsBtnAcquired]}
              onPress={captureGps}
            >
              <Ionicons
                name={gpsStatus === 'acquired' ? 'checkmark-circle' : 'locate'}
                size={20}
                color={gpsStatus === 'acquired' ? '#10B981' : '#06B6D4'}
              />
              <Text style={[styles.gpsBtnText, gpsStatus === 'acquired' && { color: '#10B981' }]}>
                {gpsStatus === 'idle' ? 'Capture GPS at this location' :
                 gpsStatus === 'acquiring' ? 'Acquiring high-accuracy lock...' :
                 gpsStatus === 'acquired' ? `${lat?.toFixed(5)}, ${lng?.toFixed(5)}` :
                 'GPS Failed — Tap to retry or open map picker'}
              </Text>
            </TouchableOpacity>
            {gpsStatus === 'failed' && (
              <TouchableOpacity style={styles.mapPickerBtn} onPress={() => openMapPicker()}>
                <Ionicons name="map-outline" size={16} color="#F59E0B" />
                <Text style={styles.mapPickerText}>Open Map Picker</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#FFF" />
              <Text style={styles.submitText}>
                {spotType === 'business' ? 'Provision Business Spot' : 'Provision Taxi Stand'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
    ...ghostBorder(0.05),
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#F1F5F9' },
  typeSplitter: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  typeTile: { flex: 1, borderRadius: 20, overflow: 'hidden', ...ghostBorder(0.06) },
  typeTileActive: { ...ghostBorder(0.2) },
  typeTileBg: { padding: 16, alignItems: 'center', gap: 8 },
  typeTileLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  typeTileLabelActive: { color: '#F1F5F9' },
  typeTileDesc: { fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  form: { flex: 1, paddingHorizontal: 20, gap: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.3)', letterSpacing: 1, marginTop: 8 },
  tagRow: { flexDirection: 'row', gap: 8 },
  inputGroup: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, ...ghostBorder(0.08),
    paddingHorizontal: 14, height: 48,
  },
  input: { flex: 1, color: '#F1F5F9', fontSize: 15 },
  scanBtn: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: VOICES.admin.accent + '4D',
    ...ghostBorder(0.4),
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtnActive: { opacity: 0.6 },
  passwordRow: { flexDirection: 'row', gap: 8 },
  regenerateBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', ...ghostBorder(0.08), alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 16, paddingHorizontal: 4 },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, ...ghostBorder(0.08),
    paddingHorizontal: 14, height: 48,
  },
  gpsBtnAcquired: { ...ghostBorder(0.3), backgroundColor: 'rgba(16,185,129,0.05)' },
  gpsBtnText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, flex: 1 },
  mapPickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  mapPickerText: { color: '#F59E0B', fontSize: 13 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14,
    backgroundColor: VOICES.admin.accent,
    marginTop: 16, marginBottom: 24,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
