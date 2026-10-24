import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { supabase } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { Button, Chip, Field, GUTTER, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
import type { AppStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'PassportSubmission'>;
type RouteT = RouteProp<AppStackParamList, 'PassportSubmission'>;

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
      toast('Full name, date of birth and passport number are required.', 'error');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      toast('Please sign in again.', 'error');
      return;
    }

    const { error } = await supabase
      .from('passenger_details')
      .upsert({
        participant_id: participantId,
        rider_id: user.id,
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
      toast('Could not save: ' + error.message, 'error');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast('Travel documents saved', 'success');
    navigation.goBack();
  };

  const m = useTheme();
  const date = { placeholder: 'YYYY-MM-DD', keyboardType: 'numbers-and-punctuation' as const, autoCorrect: false };

  return (
    <Screen
      title="Travel documents"
      onBack={() => navigation.goBack()}
      footer={<Button title="Save travel documents" loading={submitting} onPress={submit} />}
      hero={
        <View>
          <Txt variant="hero">Passport details</Txt>
          <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>The airline needs these to book your seat. Fields with * are required.</Txt>
        </View>
      }
    >
      <Field label="Full name, as on your passport *" value={fullName} onChangeText={setFullName} placeholder="JANE DOE" autoCapitalize="characters" />
      <Field label="Date of birth *" value={dateOfBirth} onChangeText={setDateOfBirth} {...date} />

      <Txt variant="label" tone="dim" style={{ marginBottom: SPACE.sm }}>Gender</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACE.sm }}>
        {GENDERS.map(g => (
          <Chip key={g} label={g.charAt(0) + g.slice(1).toLowerCase()} selected={gender === g} onPress={() => { Haptics.selectionAsync(); setGender(g); }} />
        ))}
      </View>

      <Txt variant="label" tone="dim" style={{ marginBottom: SPACE.sm }}>Nationality</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER, marginBottom: SPACE.lg }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
        {COUNTRIES.map(c => (
          <Chip key={c.code} label={c.name} selected={nationality === c.code} onPress={() => { Haptics.selectionAsync(); setNationality(c.code); }} />
        ))}
      </ScrollView>

      <Field label="Passport number *" value={passportNumber} onChangeText={setPassportNumber} placeholder="P0000000" autoCapitalize="characters" autoCorrect={false} />
      <Field label="Passport expiry date" value={passportExpiry} onChangeText={setPassportExpiry} {...date} />
      <Field label="Passport issue date" value={passportIssuanceDate} onChangeText={setPassportIssuanceDate} {...date} />
      <Field label="Where the passport was issued" value={passportIssuanceLocation} onChangeText={setPassportIssuanceLocation} placeholder="Port of Spain" />
      <Field label="Place of birth" value={birthPlace} onChangeText={setBirthPlace} placeholder="Port of Spain, Trinidad" />

      <Section title="Contact for the airline">
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="jane@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Txt variant="label" tone="dim" style={{ marginBottom: SPACE.sm }}>Country code</Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER, marginBottom: SPACE.md }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
          {COUNTRY_CODES.map(cc => (
            <Chip key={cc} label={cc} selected={phoneCountryCode === cc} onPress={() => { Haptics.selectionAsync(); setPhoneCountryCode(cc); }} />
          ))}
        </ScrollView>
        <Field label="Phone" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="000 0000" keyboardType="phone-pad" />
      </Section>

      <Section title="Emergency contact (optional)">
        <Field label="Name" value={emergencyName} onChangeText={setEmergencyName} placeholder="Contact name" />
        <Field label="Phone" value={emergencyPhone} onChangeText={setEmergencyPhone} placeholder="+1 868 000 0000" keyboardType="phone-pad" />
      </Section>
    </Screen>
  );
}
