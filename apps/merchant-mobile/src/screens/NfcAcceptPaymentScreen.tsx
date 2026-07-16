import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  useWindowDimensions, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface } from '@gtaxi/design-system/utils/style-rules';
import type { AppScreenProps } from '../navigation/types';

const { supabase } = initializeSupabaseClient('native');

type ScanMode = 'nfc' | 'qr' | 'manual';
type Phase = 'scan' | 'confirm' | 'processing' | 'success';

export function NfcAcceptPaymentScreen({ navigation }: AppScreenProps<'NfcAcceptPayment'>) {
  const insets = useSafeAreaInsets();
  const [scanMode, setScanMode] = useState<ScanMode>(Platform.OS === 'web' ? 'manual' : 'nfc');
  const [phase, setPhase] = useState<Phase>('scan');
  const [tagUid, setTagUid] = useState('');
  const [manualTag, setManualTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);

  const [riderName, setRiderName] = useState('');
  const [riderBalanceCents, setRiderBalanceCents] = useState(0);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [amountText, setAmountText] = useState('');

  const [txResult, setTxResult] = useState<{
    transaction_id: string;
    rider_balance_after_cents: number;
    amount_formatted: string;
  } | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const qrScanned = useRef(false);

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    NfcManager.start();
    NfcManager.isSupported().then(setNfcSupported);
  }, []);

  const resetQrScan = useCallback(() => { qrScanned.current = false; }, []);

  const resolveTag = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('resolve_identity_tag', {
        p_tag_uid: token,
      });
      if (rpcError) {
        setError('Failed to look up keychain. Check the tag ID and try again.');
        setLoading(false);
        return;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.found) {
        setError('Rider keychain not found. Ask the rider to register their keychain.');
        setLoading(false);
        return;
      }
      setTagUid(token);
      setRiderId(result.rider_id);
      setRiderName(result.rider_name || 'Rider');
      setRiderBalanceCents(result.wallet_balance_cents || 0);
      setPhase('confirm');
      setLoading(false);
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  }, []);

  const readNfc = useCallback(async () => {
    setError(null);
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Tap rider keychain against your phone' });
      const tag = await NfcManager.getTag();
      const uid = tag?.id;
      if (uid) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        resolveTag(uid);
      } else {
        setError('Could not read NFC tag. Try again or enter manually.');
      }
      NfcManager.cancelTechnologyRequest();
    } catch {
      NfcManager.cancelTechnologyRequest();
    }
  }, [resolveTag]);

  const handleManualSubmit = useCallback(() => {
    const token = manualTag.trim();
    if (!token) {
      setError('Enter a keychain code or scan the NFC tag.');
      return;
    }
    resolveTag(token);
  }, [manualTag, resolveTag]);

  const handleAmountChange = useCallback((text: string) => {
    setAmountText(text);
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned) {
      setAmountCents(parseInt(cleaned, 10));
    } else {
      setAmountCents(0);
    }
  }, []);

  const handleCharge = useCallback(async () => {
    if (amountCents < 100) {
      Alert.alert('Minimum Amount', 'Minimum charge is TTD $1.00');
      return;
    }
    if (amountCents > riderBalanceCents) {
      Alert.alert('Insufficient Balance', `${riderName} only has TTD $${(riderBalanceCents / 100).toFixed(2)} available.`);
      return;
    }
    setPhase('processing');
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('merchant_nfc_charge', {
        body: { tag_uid: tagUid, amount_cents: amountCents },
      });
      if (fnError) {
        setError(fnError.message || 'Payment failed. Please try again.');
        setPhase('confirm'); setLoading(false); return;
      }
      if (!data?.success) {
        setError(data?.error || 'Payment failed.');
        setPhase('confirm'); setLoading(false); return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxResult({
        transaction_id: data.data.transaction_id,
        rider_balance_after_cents: data.data.rider_balance_after_cents,
        amount_formatted: data.data.amount_formatted,
      });
      setPhase('success');
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'Payment failed.');
      setPhase('confirm'); setLoading(false);
    }
  }, [amountCents, tagUid, riderBalanceCents, riderName]);

  const handleDone = useCallback(() => {
    setPhase('scan'); setManualTag(''); setTagUid('');
    setRiderId(null); setRiderName(''); setRiderBalanceCents(0);
    setAmountCents(0); setAmountText(''); setError(null); setTxResult(null);
    resetQrScan();
  }, [resetQrScan]);

  const modes: { key: ScanMode; label: string; icon: string }[] = [
    { key: 'nfc', label: 'NFC', icon: 'phone-portrait-outline' },
    { key: 'qr', label: 'QR', icon: 'camera-outline' },
    { key: 'manual', label: 'Manual', icon: 'keypad-outline' },
  ];

  if (phase === 'processing') {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
        <View style={s.centerContent}>
          <ActivityIndicator size="large" color={VOICES.merchant.accent} />
          <Text style={s.processingText}>Processing payment...</Text>
          <Text style={s.processingSubtext}>TTD ${(amountCents / 100).toFixed(2)} to {riderName}</Text>
        </View>
      </View>
    );
  }

  if (phase === 'success') {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
        <View style={s.centerContent}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#10B981" />
          </View>
          <Text style={s.successTitle}>Payment Successful</Text>
          <Text style={s.successAmount}>{txResult?.amount_formatted}</Text>
          <Text style={s.successRider}>{riderName}</Text>
          <View style={s.balanceRow}>
            <Text style={s.balanceLabel}>Rider Balance:</Text>
            <Text style={s.balanceValue}>
              TTD ${((txResult?.rider_balance_after_cents ?? 0) / 100).toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity style={s.doneBtn} onPress={handleDone} activeOpacity={0.85}>
            <Text style={s.doneBtnText}>NEW PAYMENT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={s.backBtnText}>DASHBOARD</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBack}>
          <Ionicons name="close" size={24} color="#E9F5F3" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Accept Payment</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={s.modeTabs}>
        {modes.map((m) => {
          const disabled = m.key === 'nfc' && nfcSupported === false;
          return (
            <TouchableOpacity
              key={m.key}
              style={[s.modeTab, scanMode === m.key && s.modeTabActive]}
              onPress={() => { setScanMode(m.key); resetQrScan(); setError(null); }}
              disabled={!!disabled}
              activeOpacity={0.7}
            >
              <Ionicons name={m.icon as any} size={18} color={scanMode === m.key ? '#0A0F0E' : disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)'} />
              <Text style={[s.modeTabText, scanMode === m.key && s.modeTabTextActive, disabled && { opacity: 0.2 }]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {phase === 'scan' && (
          <>
            {scanMode === 'nfc' && (
              <>
                <View style={s.illustrationArea}>
                  <View style={s.nfcPulse}>
                    <View style={s.nfcRingOuter} />
                    <View style={s.nfcRingInner} />
                    <View style={s.nfcIconWrap}>
                      <Ionicons name="phone-portrait-outline" size={40} color={VOICES.merchant.accent} />
                    </View>
                  </View>
                  <Text style={s.scanTitle}>Tap Rider Keychain</Text>
                  <Text style={s.scanSubtitle}>
                    Ask the rider to hold their G-Taxi keychain near the top of your phone.
                  </Text>
                </View>
                <TouchableOpacity style={s.nfcScanBtn} onPress={readNfc} activeOpacity={0.85}>
                  <Ionicons name="scan-outline" size={22} color="#0A0F0E" />
                  <Text style={s.nfcScanBtnText}>TAP TO SCAN</Text>
                </TouchableOpacity>
                {nfcSupported === false && (
                  <Text style={s.warningText}>NFC not supported on this device. Use QR or Manual.</Text>
                )}
              </>
            )}

            {scanMode === 'qr' && (
              <>
                <View style={s.illustrationArea}>
                  <Text style={s.scanTitle}>Scan Rider QR</Text>
                  <Text style={s.scanSubtitle}>
                    Ask the rider to show their G-Taxi QR code from their profile.
                  </Text>
                </View>
                {cameraPermission?.granted ? (
                  <View style={s.cameraWrap}>
                    <CameraView
                      style={s.camera}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={(result) => {
                        if (result.data && !qrScanned.current) {
                          qrScanned.current = true;
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          resolveTag(result.data);
                        }
                      }}
                    />
                    {loading && (
                      <View style={s.cameraOverlay}>
                        <ActivityIndicator size="large" color={VOICES.merchant.accent} />
                        <Text style={s.cameraOverlayText}>Looking up rider...</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={s.cameraPrompt}>
                    <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.3)" />
                    <Text style={s.cameraPromptText}>Camera permission needed to scan QR codes</Text>
                    <TouchableOpacity style={s.permissionBtn} onPress={requestCameraPermission} activeOpacity={0.85}>
                      <Text style={s.permissionBtnText}>ENABLE CAMERA</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {scanMode === 'manual' && (
              <>
                <View style={s.illustrationArea}>
                  <View style={[s.nfcRingOuter, { width: 90, height: 90, borderRadius: 45, borderWidth: 0 }]}>
                    <Ionicons name="keypad-outline" size={40} color={VOICES.merchant.accent} />
                  </View>
                  <Text style={s.scanTitle}>Enter Keychain Code</Text>
                  <Text style={s.scanSubtitle}>
                    Type the rider's keychain tag code printed on their G-Taxi keychain.
                  </Text>
                </View>
                <View style={[s.inputCard, glassSurface(0.15)]}>
                  <Text style={s.inputLabel}>KEYCHAIN CODE</Text>
                  <TextInput
                    style={s.textInput}
                    placeholder="e.g. GT-ABCD-1234"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={manualTag}
                    onChangeText={setManualTag}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[s.submitBtn, !manualTag.trim() && s.btnDisabled]}
                    onPress={handleManualSubmit}
                    disabled={!manualTag.trim() || loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#0A0F0E" />
                    ) : (
                      <Text style={s.submitBtnText}>LOOK UP RIDER</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {error && (
              <Text style={s.errorText}>{error}</Text>
            )}
          </>
        )}

        {phase === 'confirm' && (
          <>
            <View style={[s.riderCard, glassSurface(0.15)]}>
              <View style={s.riderAvatar}>
                <Ionicons name="person" size={28} color={VOICES.merchant.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.riderLabel}>RIDER</Text>
                <Text style={s.riderNameValue}>{riderName}</Text>
                <Text style={s.riderBalance}>
                  Wallet: TTD ${(riderBalanceCents / 100).toFixed(2)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setPhase('scan'); resetQrScan(); }} style={s.changeTagBtn}>
                <Ionicons name="refresh" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <View style={[s.amountCard, glassSurface(0.15)]}>
              <Text style={s.inputLabel}>CHARGE AMOUNT (TTD)</Text>
              <View style={s.amountInputRow}>
                <Text style={s.dollarSign}>$</Text>
                <TextInput
                  style={s.amountInput}
                  placeholder="0.00"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  value={amountText}
                  onChangeText={handleAmountChange}
                  keyboardType="numeric"
                  autoFocus
                />
              </View>
              {amountCents > 0 && (
                <Text style={[
                  s.balanceHint,
                  amountCents > riderBalanceCents && s.balanceHintError,
                ]}>
                  {amountCents > riderBalanceCents
                    ? 'Exceeds rider balance'
                    : `Rider will have TTD $${((riderBalanceCents - amountCents) / 100).toFixed(2)} remaining`
                  }
                </Text>
              )}

              {error && <Text style={s.errorText}>{error}</Text>}

              <TouchableOpacity
                style={[s.chargeBtn, (amountCents < 100 || amountCents > riderBalanceCents) && s.btnDisabled]}
                onPress={handleCharge}
                disabled={amountCents < 100 || amountCents > riderBalanceCents || loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#0A0F0E" />
                ) : (
                  <Text style={s.chargeBtnText}>
                    CHARGE TTD ${(amountCents / 100).toFixed(2)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16,
  },
  headerBack: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  modeTabs: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 8,
  },
  modeTab: {
    flex: 1, flexDirection: 'row', height: 40, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center', gap: 6,
  },
  modeTabActive: { backgroundColor: VOICES.merchant.accent },
  modeTabText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.6)', fontFamily: 'SpaceGrotesk' },
  modeTabTextActive: { color: '#0A0F0E' },
  scrollContent: { padding: 24, paddingBottom: 48 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  illustrationArea: { alignItems: 'center', paddingVertical: 28 },
  nfcPulse: { width: 140, height: 140, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  nfcRingOuter: {
    position: 'absolute', width: 140, height: 140, borderRadius: 70,
    borderWidth: 1.5, borderColor: VOICES.merchant.accent + '30',
  },
  nfcRingInner: {
    position: 'absolute', width: 110, height: 110, borderRadius: 55,
    borderWidth: 1.5, borderColor: VOICES.merchant.accent + '50',
  },
  nfcIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: VOICES.merchant.accent + '15',
    justifyContent: 'center', alignItems: 'center',
  },
  scanTitle: { fontSize: 22, fontWeight: '700', color: '#E9F5F3', marginBottom: 8, fontFamily: 'SpaceGrotesk' },
  scanSubtitle: { fontSize: 14, color: VOICES.merchant.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  nfcScanBtn: {
    flexDirection: 'row', height: 52, borderRadius: 14, backgroundColor: VOICES.merchant.accent,
    justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8,
  },
  nfcScanBtnText: { fontSize: 15, fontWeight: '800', color: '#0A0F0E', letterSpacing: 1, fontFamily: 'SpaceGrotesk' },
  warningText: { fontSize: 12, color: '#F59E0B', textAlign: 'center', marginTop: 12, fontFamily: 'Manrope' },
  cameraWrap: { height: 300, borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  camera: { flex: 1 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },
  cameraOverlayText: { fontSize: 14, color: '#E9F5F3', marginTop: 12, fontFamily: 'Manrope' },
  cameraPrompt: {
    height: 240, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 16,
  },
  cameraPromptText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', paddingHorizontal: 32, fontFamily: 'Manrope' },
  permissionBtn: { height: 44, borderRadius: 10, backgroundColor: VOICES.merchant.accent, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  permissionBtnText: { fontSize: 13, fontWeight: '800', color: '#0A0F0E', letterSpacing: 1, fontFamily: 'SpaceGrotesk' },
  inputCard: { borderRadius: 20, padding: 20 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 1.5, fontFamily: 'Manrope' },
  textInput: {
    height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16, fontSize: 16, color: '#E9F5F3', fontFamily: 'SpaceGrotesk',
  },
  submitBtn: { height: 52, borderRadius: 14, backgroundColor: VOICES.merchant.accent, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  btnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#0A0F0E', letterSpacing: 1, fontFamily: 'SpaceGrotesk' },
  errorText: { fontSize: 13, color: '#EF4444', marginTop: 12, textAlign: 'center', fontFamily: 'Manrope' },
  riderCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 20, marginBottom: 24, gap: 16 },
  riderAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: VOICES.merchant.accent + '20', justifyContent: 'center', alignItems: 'center' },
  riderLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 1, fontFamily: 'Manrope' },
  riderNameValue: { fontSize: 20, fontWeight: '700', color: '#E9F5F3', marginTop: 2, fontFamily: 'SpaceGrotesk' },
  riderBalance: { fontSize: 13, color: '#10B981', marginTop: 4, fontFamily: 'Manrope' },
  changeTagBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  amountCard: { borderRadius: 20, padding: 20 },
  amountInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dollarSign: { fontSize: 32, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  amountInput: { flex: 1, height: 60, fontSize: 32, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  balanceHint: { fontSize: 12, color: '#F59E0B', marginTop: 8, fontFamily: 'Manrope' },
  balanceHintError: { color: '#EF4444' },
  chargeBtn: { height: 56, borderRadius: 16, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  chargeBtnText: { fontSize: 16, fontWeight: '800', color: '#0A0F0E', letterSpacing: 1, fontFamily: 'SpaceGrotesk' },
  processingText: { fontSize: 20, fontWeight: '700', color: '#E9F5F3', marginTop: 24, fontFamily: 'SpaceGrotesk' },
  processingSubtext: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 8, fontFamily: 'Manrope' },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 24, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  successAmount: { fontSize: 40, fontWeight: '800', color: '#10B981', marginTop: 8, fontFamily: 'SpaceGrotesk' },
  successRider: { fontSize: 16, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontFamily: 'Manrope' },
  balanceRow: { flexDirection: 'row', gap: 8, marginTop: 24, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  balanceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontFamily: 'Manrope' },
  balanceValue: { fontSize: 14, fontWeight: '700', color: '#10B981', fontFamily: 'SpaceGrotesk' },
  doneBtn: { height: 52, borderRadius: 14, backgroundColor: VOICES.merchant.accent, justifyContent: 'center', alignItems: 'center', marginTop: 32, paddingHorizontal: 32 },
  doneBtnText: { fontSize: 15, fontWeight: '800', color: '#0A0F0E', letterSpacing: 1, fontFamily: 'SpaceGrotesk' },
  backBtn: { marginTop: 12 },
  backBtnText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.4)', textAlign: 'center', letterSpacing: 1, fontFamily: 'Manrope' },
});
