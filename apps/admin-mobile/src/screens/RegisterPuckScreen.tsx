import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { initializeSupabaseClient } from '@gtaxi/core';
import { VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

export const RegisterPuckScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [puckId, setPuckId] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  useEffect(() => {
    async function acquireTelemetry() {
      setIsLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'GPS verification is necessary to record hardware coordinates.');
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      } catch (err) {
        console.error('GPS telemetry error:', err);
      } finally {
        setIsLocating(false);
      }
    }
    acquireTelemetry();
  }, []);

  const handleRegisterNode = async () => {
    if (!puckId.trim() || !merchantName.trim()) {
      Alert.alert('Validation Error', 'Hardware UID and partner name cannot be empty.');
      return;
    }

    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: {
          action: 'manage_nodes', action_type: 'upsert',
          node: {
            tag_uid: puckId.trim().toUpperCase(),
            location_name: merchantName.trim(),
            lat: latitude,
            lng: longitude,
            is_active: true,
          },
        },
      });

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Node Provisioned', `G-Touch Point ${puckId.toUpperCase()} is active at ${merchantName}.`);
      setPuckId('');
      setMerchantName('');
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Provisioning Failed', err.message || 'Edge function rejected the request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <LinearGradient colors={[BG, '#0B1120']} style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Field Node Registration</Text>
          <View style={{ width: 34 }} />
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.infoCard}>
            <Ionicons name="hardware-chip-outline" size={20} color={ACCENT} />
            <View style={styles.infoTextBlock}>
              <Text style={styles.infoTitle}>Bind raw NFC tag</Text>
              <Text style={styles.infoDesc}>Register a puck to a physical location. Coordinates are captured automatically via GPS.</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>HARDWARE UID</Text>
          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="e.g. 046F32A29C5E80"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={puckId}
              onChangeText={setPuckId}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <Text style={styles.sectionLabel}>PARTNER / LOCATION NAME</Text>
          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="e.g. Sangre Grande Barber Elite"
              placeholderTextColor="rgba(255,255,255,0.2)"
              value={merchantName}
              onChangeText={setMerchantName}
            />
          </View>

          <View style={styles.telemetryCard}>
            <View style={styles.telemetryRow}>
              <Ionicons
                name={isLocating ? 'hourglass' : latitude ? 'checkmark-circle' : 'locate'}
                size={16}
                color={isLocating ? ACCENT : latitude ? '#10B981' : 'rgba(255,255,255,0.3)'}
              />
              <Text style={styles.telemetryTitle}>WGS84 Coordinates</Text>
            </View>
            {isLocating ? (
              <View style={styles.telemetryLoading}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.telemetryStatus}>Acquiring GPS lock...</Text>
              </View>
            ) : latitude && longitude ? (
              <Text style={styles.telemetryData}>
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </Text>
            ) : (
              <Text style={styles.telemetryWarn}>No GPS fix — location will be null</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, isSubmitting && { opacity: 0.5 }]}
            onPress={handleRegisterNode}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.submitText}>Register Field Node</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerPad: {
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#F1F5F9' },
  scrollContent: { padding: 20, gap: 14 },
  infoCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: `${ACCENT}08`,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: `${ACCENT}20`,
    marginBottom: 4,
  },
  infoTextBlock: { flex: 1 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: '#F1F5F9' },
  infoDesc: { fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 16, marginTop: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.25)', letterSpacing: 1.2 },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  input: { flex: 1, color: '#F1F5F9', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  telemetryCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  telemetryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  telemetryTitle: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  telemetryLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  telemetryStatus: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  telemetryData: { fontSize: 12, color: '#10B981', fontFamily: 'monospace', marginTop: 2 },
  telemetryWarn: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: 12,
    backgroundColor: ACCENT,
    marginTop: 8,
  },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});
