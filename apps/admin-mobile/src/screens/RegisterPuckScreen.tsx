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
  ScrollView
} from 'react-native';
import * as Location from 'expo-location';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

export const RegisterPuckScreen: React.FC = () => {
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
          Alert.alert('Telemetry Alert', 'GPS verification is necessary to record hardware coordinates.');
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      } catch (err) {
        console.error('GPS telemetry compilation error:', err);
      } finally {
        setIsLocating(false);
      }
    }
    acquireTelemetry();
  }, []);

  const handleRegisterNode = async () => {
    if (!puckId.trim() || !merchantName.trim()) {
      Alert.alert('Validation Error', 'Hardware Puck UID and Merchant Label cannot be empty.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin_manage_nodes', {
        body: {
          action: 'upsert',
          node: {
            tag_uid: puckId.trim().toUpperCase(),
            location_name: merchantName.trim(),
            lat: latitude,
            lng: longitude,
            is_active: true
          }
        },
      });

      if (error) throw error;

      Alert.alert('Node Provisioned', `Puck ${puckId.toUpperCase()} is active at ${merchantName}.`);
      setPuckId('');
      setMerchantName('');
    } catch (err: any) {
      Alert.alert('Provisioning Failure', err.message || 'The edge function interface rejected the request block.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Cluster Node Provisioning</Text>
        <Text style={styles.subtitle}>Bind raw NFC tags directly to network coordinates from the sidewalk.</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>HARDWARE PUCK UID</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., 046F32A29C5E80"
            placeholderTextColor="#555"
            value={puckId}
            onChangeText={setPuckId}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>MERCHANT BUSINESS ENTITY NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Sangre Grande Barber Elite"
            placeholderTextColor="#555"
            value={merchantName}
            onChangeText={setMerchantName}
          />
        </View>

        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryTitle}>WGS84 Navigation Alignment</Text>
          {isLocating ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : latitude && longitude ? (
            <Text style={styles.telemetryData}>Coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}</Text>
          ) : (
            <Text style={styles.telemetryWarning}>Degraded GPS signal tracking bounds.</Text>
          )}
        </View>

        <TouchableOpacity style={styles.submitButton} onPress={handleRegisterNode} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.submitButtonText}>AUTHORIZE FIELD NODE</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContainer: { padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#8E8E93', marginBottom: 24, lineHeight: 18 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '600', color: '#8E8E93', marginBottom: 8, letterSpacing: 0.5 },
  input: { backgroundColor: '#1C1C1E', color: '#FFFFFF', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#2C2C2E' },
  telemetryCard: { backgroundColor: '#1C1C1E', padding: 16, borderRadius: 10, marginBottom: 24, borderWidth: 1, borderColor: '#2C2C2E' },
  telemetryTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  telemetryData: { color: '#34C759', fontSize: 12, fontFamily: 'monospace' },
  telemetryWarning: { color: '#FF3B30', fontSize: 12 },
  submitButton: { backgroundColor: '#34C759', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  submitButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 }
});
