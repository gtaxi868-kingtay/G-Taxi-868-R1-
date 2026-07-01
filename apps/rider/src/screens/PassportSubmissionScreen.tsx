import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, StyleSheet, SafeAreaView, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import type { AppStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'PassportSubmission'>;
type RouteT = RouteProp<AppStackParamList, 'PassportSubmission'>;

const CYAN = '#34E6EC';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

const COUNTRIES = [
  { code: 'TT', name: 'Trinidad & Tobago' },
  { code: 'BB', name: 'Barbados' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'BZ', name: 'Belize' },
  { code: 'GY', name: 'Guyana' },
  { code: 'SR', name: 'Suriname' },
  { code: 'GD', name: 'Grenada' },
  { code: 'LC', name: 'St. Lucia' },
  { code: 'VC', name: 'St. Vincent & Grenadines' },
  { code: 'AG', name: 'Antigua & Barbuda' },
  { code: 'DM', name: 'Dominica' },
  { code: 'KN', name: 'St. Kitts & Nevis' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
];

const COUNTRY_CODES = ['+1', '+44', '+1246', '+1268', '+1473', '+1649', '+1767', '+1868', '+1876', '+592', '+501', '+597', '+599'];

export default function PassportSubmissionScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const insets = useSafeAreaInsets();
  const { participantId } = route.params;

  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [nationality, setNationality] = useState('TT');
  const [passportNumber, setPassportNumber] = useState('');
  const [passportExpiry, setPassportExpiry] = useState('');
  const [passportIssuanceDate, setPassportIssuanceDate] = useState('');
  const [passportIssuanceLocation, setPassportIssuanceLocation] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+1868');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!fullName.trim() || !dateOfBirth.trim() || !passportNumber.trim()) {
      Alert.alert('Missing info', 'Full name, date of birth, and passport number are required.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    const { error } = await supabase
      .from('passenger_details')
      .upsert({
        participant_id: participantId,
        full_name: fullName.trim(),
        date_of_birth: dateOfBirth.trim(),
        gender,
        nationality: nationality.trim(),
        passport_number: passportNumber.trim(),
        passport_expiry: passportExpiry.trim() || null,
        passport_issuance_date: passportIssuanceDate.trim() || null,
        passport_issuance_location: passportIssuanceLocation.trim() || null,
        birth_place: birthPlace.trim() || null,
        email: email.trim() || null,
        phone_country_code: phoneCountryCode.replace('+', ''),
        phone_number: phoneNumber.trim() || null,
        emergency_name: emergencyName.trim() || null,
        emergency_phone: emergencyPhone.trim() || null,
      }, { onConflict: 'participant_id' });

    setSubmitting(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Submitted!', 'Your travel documents have been saved. You\'re all set for check-in.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <LinearGradient colors={['#07070F', '#050508']} style={StyleSheet.absoluteFill} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#EAF3F6" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Travel Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Ionicons name="document-text-outline" size={28} color={CYAN} style={{ marginBottom: 8 }} />
          <Text style={styles.cardTitle}>Passport & Contact Details</Text>
          <Text style={styles.cardSubtitle}>
            Required for the airline booking. We only store this for the duration of your trip.
          </Text>
        </View>

        <Text style={styles.label}>Full name (as on passport) *</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="JANE DOE"
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Date of birth *</Text>
        <TextInput
          style={styles.input}
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <Text style={styles.label}>Gender</Text>
        <View style={styles.pickerRow}>
          {GENDERS.map(g => (
            <TouchableOpacity
              key={g}
              style={[styles.pickerOption, gender === g && styles.pickerOptionActive]}
              onPress={() => { Haptics.selectionAsync(); setGender(g); }}
            >
              <Text style={[styles.pickerText, gender === g && styles.pickerTextActive]}>
                {g.charAt(0) + g.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Nationality</Text>
        <View style={styles.pickerScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
            {COUNTRIES.map(c => (
              <TouchableOpacity
                key={c.code}
                style={[styles.pickerOption, nationality === c.code && styles.pickerOptionActive]}
                onPress={() => { Haptics.selectionAsync(); setNationality(c.code); }}
              >
                <Text style={[styles.pickerText, nationality === c.code && styles.pickerTextActive]}>
                  {c.code}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <Text style={styles.label}>Passport number *</Text>
        <TextInput
          style={styles.input}
          value={passportNumber}
          onChangeText={setPassportNumber}
          placeholder="P0000000"
          placeholderTextColor="rgba(255,255,255,0.25)"
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Passport expiry date</Text>
        <TextInput
          style={styles.input}
          value={passportExpiry}
          onChangeText={setPassportExpiry}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <Text style={styles.label}>Passport issuance date</Text>
        <TextInput
          style={styles.input}
          value={passportIssuanceDate}
          onChangeText={setPassportIssuanceDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <Text style={styles.label}>Passport issuance location</Text>
        <TextInput
          style={styles.input}
          value={passportIssuanceLocation}
          onChangeText={setPassportIssuanceLocation}
          placeholder="Port of Spain"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <Text style={styles.label}>Place of birth</Text>
        <TextInput
          style={styles.input}
          value={birthPlace}
          onChangeText={setBirthPlace}
          placeholder="Port of Spain, Trinidad"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Contact (for airline booking)</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="jane@example.com"
          placeholderTextColor="rgba(255,255,255,0.25)"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Phone</Text>
        <View style={styles.phoneRow}>
          <View style={styles.countryCodePicker}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {COUNTRY_CODES.map(cc => (
                <TouchableOpacity
                  key={cc}
                  style={[styles.ccOption, phoneCountryCode === cc && styles.ccOptionActive]}
                  onPress={() => { Haptics.selectionAsync(); setPhoneCountryCode(cc); }}
                >
                  <Text style={[styles.ccText, phoneCountryCode === cc && styles.ccTextActive]}>{cc}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="000 0000"
            placeholderTextColor="rgba(255,255,255,0.25)"
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Emergency contact (optional)</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={emergencyName}
          onChangeText={setEmergencyName}
          placeholder="Contact name"
          placeholderTextColor="rgba(255,255,255,0.25)"
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          value={emergencyPhone}
          onChangeText={setEmergencyPhone}
          placeholder="+1 868 000 0000"
          placeholderTextColor="rgba(255,255,255,0.25)"
          keyboardType="phone-pad"
        />

        <TouchableOpacity
          onPress={submit}
          disabled={submitting}
          style={styles.submitBtn}
          activeOpacity={0.8}
        >
          <LinearGradient colors={[CYAN, '#0DA0A6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGradient}>
            {submitting ? (
              <ActivityIndicator color="#050508" />
            ) : (
              <Text style={styles.submitText}>Submit Travel Documents</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#EAF3F6' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 24, alignItems: 'center', marginBottom: 28,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#EAF3F6', marginBottom: 8 },
  cardSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20 },
  label: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 16,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 16, fontSize: 15, color: '#EAF3F6',
  },
  pickerScroll: { marginTop: 4 },
  pickerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pickerOption: {
    paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pickerOptionActive: {
    borderColor: CYAN, backgroundColor: `${CYAN}1A`,
  },
  pickerText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  pickerTextActive: { color: '#EAF3F6', fontWeight: '700' },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  countryCodePicker: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 0, paddingHorizontal: 8, height: 53,
    justifyContent: 'center', maxWidth: 180,
  },
  ccOption: {
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, marginHorizontal: 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  ccOptionActive: { backgroundColor: `${CYAN}26` },
  ccText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  ccTextActive: { color: '#EAF3F6' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#EAF3F6', marginBottom: 4 },
  submitBtn: { marginTop: 32, borderRadius: 16, overflow: 'hidden' },
  submitGradient: { paddingVertical: 18, alignItems: 'center' },
  submitText: { fontSize: 15, fontWeight: '800', color: '#050508' },
});
