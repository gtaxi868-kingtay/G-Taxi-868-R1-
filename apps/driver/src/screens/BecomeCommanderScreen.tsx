import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { AppScreenProps } from '../navigation/types';
import { LiquidGlassCard } from '../components/LiquidGlassCard';

const { supabase } = initializeSupabaseClient('native');

const PREREQ_RIDES = 500;
const PREREQ_RATING = 4.8;

const REVSHARE_RULES = [
  {
    icon: 'trending-up-sharp',
    title: '2% Network Override',
    body: 'You earn 2% of the platform fee from every ride completed by drivers in your territory — deducted from the driver\'s 80% share, not the platform cut.',
  },
  {
    icon: 'people-sharp',
    title: 'Recruit & Scale',
    body: 'Your onboarding code unlocks new driver signups. Every driver you recruit adds to your passive override base.',
  },
  {
    icon: 'map-sharp',
    title: 'Territory Rights',
    body: 'Assigned a defined territory (e.g. Sangre Grande, San Fernando). You own the recruiting rights — no other commander operates in your zone.',
  },
  {
    icon: 'cash-sharp',
    title: 'Weekly Settlements',
    body: 'Commander revshare accrues per-ride and settles weekly via bank transfer or WiPay ATM cash code. TTD $500 minimum withdrawal.',
  },
  {
    icon: 'shield-checkmark-sharp',
    title: 'Fleet Quality Score',
    body: 'Your fleet\'s average rating, completion rate, and incident count affect your territory\'s priority matching. High quality = more rides for your drivers.',
  },
  {
    icon: 'rocket-sharp',
    title: 'G-Member Perks Stack',
    body: 'If you are also a G-Member, your 15% discount and priority matching apply to your personal rides. Commander override is additive.',
  },
];

const CHECKLIST_ITEMS = [
  'I have read and understand the 2% network override structure',
  'I confirm I have 500+ completed rides on the G-Taxi platform',
  'I confirm my driver rating is 4.8 or higher',
  'I agree to recruit and onboard drivers in my assigned territory',
  'I understand that commander status can be revoked for non-compliance',
  'I agree to the weekly settlement and bank details requirement',
];

export function BecomeCommanderScreen({ navigation }: AppScreenProps<'BecomeCommander'>) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [driverStats, setDriverStats] = useState<{
    rides_count: number;
    rating: number;
  } | null>(null);

  const [checklist, setChecklist] = useState<boolean[]>(new Array(CHECKLIST_ITEMS.length).fill(false));
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const isUnlocked =
    driverStats !== null &&
    driverStats.rides_count >= PREREQ_RIDES &&
    driverStats.rating >= PREREQ_RATING;

  const ridesProgress = driverStats
    ? Math.min(100, Math.round((driverStats.rides_count / PREREQ_RIDES) * 100))
    : 0;
  const ratingProgress = driverStats
    ? Math.min(100, Math.round((driverStats.rating / PREREQ_RATING) * 100))
    : 0;

  const allChecked = checklist.every(Boolean);
  const canSubmit = isUnlocked && allChecked && agreedToTerms;

  const fetchPrerequisites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Not authenticated'); setLoading(false); return; }
      const { data: driverRow, error: driverErr } = await supabase
        .from('drivers')
        .select('rides_count, rating')
        .eq('user_id', user.id)
        .maybeSingle();
      if (driverErr) throw driverErr;
      if (driverRow) {
        setDriverStats({
          rides_count: driverRow.rides_count || 0,
          rating: driverRow.rating || 0,
        });
      } else {
        setDriverStats({ rides_count: 0, rating: 0 });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load driver stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrerequisites(); }, [fetchPrerequisites]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'Not authenticated'); return; }

      const { error: insertError } = await supabase.from('commander_applications').insert({
        user_id: user.id,
        full_name: '',
        phone: '',
        area: '',
        reasoning: 'Commander application via G-Level unlock',
        status: 'pending',
      });
      if (insertError) {
        if (insertError.code === '23505') {
          Alert.alert('Already Applied', 'You already have a pending application.');
          return;
        }
        throw insertError;
      }

      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Application Failed', err.message || 'Could not submit application.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleChecklist = (index: number) => {
    const next = [...checklist];
    next[index] = !next[index];
    setChecklist(next);
  };

  const renderLocked = () => (
    <ScrollView
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
    >
      <LiquidGlassCard accentColor="#F59E0B" style={{ marginBottom: 24 }}>
        <View style={s.lockIcon}>
          <Ionicons name="lock-closed-sharp" size={36} color="#F59E0B" />
        </View>
        <Text style={[s.heading, { color: '#F59E0B', textAlign: 'center' }]}>Prerequisites Not Met</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>
          Complete {PREREQ_RIDES} rides and maintain a {PREREQ_RATING}+ rating to unlock Commander status.
        </Text>
      </LiquidGlassCard>

      {/* RIDES PROGRESS */}
      <LiquidGlassCard accentColor="#60A5FA" style={{ marginBottom: 16 }}>
        <View style={s.progressHeader}>
          <Ionicons name="car-sport-sharp" size={18} color="#60A5FA" />
          <Text style={[s.progressLabel, { color: '#60A5FA' }]}>LIFETIME RIDES</Text>
        </View>
        <View style={s.progressRingContainer}>
          <View style={s.progressRing}>
            <View style={[s.progressRingFill, { width: `${ridesProgress}%` as any, backgroundColor: '#60A5FA' }]} />
          </View>
          <View style={s.progressStats}>
            <Text style={s.progressValue}>{driverStats?.rides_count || 0}</Text>
            <Text style={s.progressGoal}>/ {PREREQ_RIDES}</Text>
          </View>
        </View>
        <Text style={s.progressHelp}>
          {ridesProgress >= 100
            ? 'Rides requirement met'
            : `${PREREQ_RIDES - (driverStats?.rides_count || 0)} more rides needed`}
        </Text>
      </LiquidGlassCard>

      {/* RATING PROGRESS */}
      <LiquidGlassCard accentColor="#A78BFA" style={{ marginBottom: 16 }}>
        <View style={s.progressHeader}>
          <Ionicons name="star-sharp" size={18} color="#A78BFA" />
          <Text style={[s.progressLabel, { color: '#A78BFA' }]}>DRIVER RATING</Text>
        </View>
        <View style={s.progressRingContainer}>
          <View style={s.progressRing}>
            <View style={[s.progressRingFill, { width: `${ratingProgress}%` as any, backgroundColor: '#A78BFA' }]} />
          </View>
          <View style={s.progressStats}>
            <Text style={s.progressValue}>{driverStats?.rating.toFixed(1) || '0.0'}</Text>
            <Text style={s.progressGoal}>/ {PREREQ_RATING}</Text>
          </View>
        </View>
        <Text style={s.progressHelp}>
          {ratingProgress >= 100
            ? 'Rating requirement met'
            : `${Math.round((PREREQ_RATING - (driverStats?.rating || 0)) * 10) / 10} points needed`}
        </Text>
      </LiquidGlassCard>

      {/* LOCKED INFO */}
      <LiquidGlassCard accentColor="#F59E0B">
        <View style={s.benefitsList}>
          <Text style={[s.sectionTitle, { color: '#F59E0B' }]}>UNLOCK COMMANDER</Text>
          {[
            'Earn 2% override on every ride in your territory',
            'Recruit and manage your own driver fleet',
            'Weekly settlements via bank transfer or WiPay',
            'Exclusive territory rights — no overlap',
          ].map((benefit, i) => (
            <View key={i} style={s.benefitRow}>
              <Ionicons name="sparkles-sharp" size={14} color="#F59E0B" />
              <Text style={s.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>
      </LiquidGlassCard>
    </ScrollView>
  );

  const renderUnlocked = () => (
    <ScrollView
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* UNLOCKED BADGE */}
      <LiquidGlassCard accentColor="#4ADE80" style={{ marginBottom: 20 }}>
        <View style={s.lockIcon}>
          <Ionicons name="shield-checkmark-sharp" size={36} color="#4ADE80" />
        </View>
        <Text style={[s.heading, { color: '#4ADE80', textAlign: 'center' }]}>You Qualify</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>
          You meet the requirements. Review the Commander terms below and apply.
        </Text>
      </LiquidGlassCard>

      {/* STATS CONFIRMATION */}
      <LiquidGlassCard accentColor="#60A5FA" style={{ marginBottom: 20 }}>
        <View style={s.progressHeader}>
          <Ionicons name="stats-chart-sharp" size={16} color="#60A5FA" />
          <Text style={[s.progressLabel, { color: '#60A5FA' }]}>YOUR STATS</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontFamily: 'Inter_700Bold' }}>{driverStats?.rides_count || 0}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: 1 }}>RIDES</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 24, fontFamily: 'Inter_700Bold' }}>{driverStats?.rating.toFixed(1) || '0.0'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: 1 }}>RATING</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <View style={{ backgroundColor: '#4ADE80', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
              <Text style={{ color: '#000', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 }}>QUALIFIED</Text>
            </View>
          </View>
        </View>
      </LiquidGlassCard>

      {/* REVSHARE RULES */}
      <LiquidGlassCard accentColor="#A78BFA" style={{ marginBottom: 20 }}>
        <Text style={[s.sectionTitle, { color: '#A78BFA', marginBottom: 16 }]}>2% NETWORK OVERRIDE</Text>
        {REVSHARE_RULES.map((rule, i) => (
          <View key={i} style={s.ruleRow}>
            <View style={s.ruleIcon}>
              <Ionicons name={rule.icon as any} size={18} color="#A78BFA" />
            </View>
            <View style={s.ruleBody}>
              <Text style={s.ruleTitle}>{rule.title}</Text>
              <Text style={s.ruleText}>{rule.body}</Text>
            </View>
          </View>
        ))}
      </LiquidGlassCard>

      {/* AGREEMENT CHECKLIST */}
      <LiquidGlassCard accentColor="#F59E0B" style={{ marginBottom: 20 }}>
        <Text style={[s.sectionTitle, { color: '#F59E0B', marginBottom: 16 }]}>AGREEMENT CHECKLIST</Text>
        {CHECKLIST_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={s.checkRow}
            onPress={() => toggleChecklist(i)}
            activeOpacity={0.7}
          >
            <View style={[s.checkbox, checklist[i] && s.checkboxChecked]}>
              {checklist[i] && <Ionicons name="checkmark-sharp" size={12} color="#000" />}
            </View>
            <Text style={s.checkLabel}>{item}</Text>
          </TouchableOpacity>
        ))}
      </LiquidGlassCard>

      {/* TERMS AGREEMENT */}
      <LiquidGlassCard accentColor="#34E6EC" style={{ marginBottom: 20 }}>
        <TouchableOpacity
          style={s.termsRow}
          onPress={() => setAgreedToTerms(!agreedToTerms)}
          activeOpacity={0.7}
        >
          <View style={[s.checkbox, agreedToTerms && s.checkboxCheckedTerms]}>
            {agreedToTerms && <Ionicons name="checkmark-sharp" size={12} color="#000" />}
          </View>
          <Text style={s.termsLabel}>
            I agree to the {'\n'}
            <Text style={{ color: '#34E6EC' }}>Commander Terms of Service</Text> and {'\n'}
            <Text style={{ color: '#34E6EC' }}>Revshare Agreement</Text>
          </Text>
        </TouchableOpacity>
      </LiquidGlassCard>

      {/* SUBMIT CTA */}
      <TouchableOpacity
        style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit || submitting}
        activeOpacity={0.85}
      >
        {submitting ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <>
            <Ionicons name="shield-checkmark-sharp" size={20} color="#000" />
            <Text style={s.submitBtnText}>
              {allChecked && agreedToTerms ? 'APPLY TO BECOME COMMANDER' : 'COMPLETE CHECKLIST TO APPLY'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  if (submitted) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>G-LEAD</Text>
        </View>
        <View style={s.successWrap}>
          <View style={s.successIcon}>
            <Ionicons name="shield-checkmark-sharp" size={72} color="#4ADE80" />
          </View>
          <Text style={s.successTitle}>Application Submitted</Text>
          <Text style={s.successBody}>
            Your Commander application is under review. HQ will verify your stats and contact you within 48 hours. You will receive a push notification when approved.
          </Text>
          <TouchableOpacity style={s.doneCta} onPress={() => navigation.goBack()}>
            <Text style={s.doneCtaText}>BACK TO PROFILE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>G-LEAD</Text>
        </View>
        <View style={s.loadingWrap}>
          <ActivityIndicator color="#F59E0B" size="large" />
          <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 16, fontSize: 12, letterSpacing: 1 }}>
            CHECKING PREREQUISITES...
          </Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>G-LEAD</Text>
        </View>
        <View style={s.loadingWrap}>
          <Ionicons name="alert-circle-sharp" size={48} color="#EF4444" />
          <Text style={{ color: '#EF4444', marginTop: 16, fontSize: 14 }}>{error}</Text>
          <TouchableOpacity
            onPress={fetchPrerequisites}
            style={{ marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <Text style={{ color: '#FFF', fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 }}>RETRY</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={{ marginLeft: 8 }}>
          <Text style={s.headerTitle}>BECOME A G</Text>
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase' }}>
            Commander Program
          </Text>
        </View>
      </View>

      {isUnlocked ? renderUnlocked() : renderLocked()}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050505' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.2)',
    borderLeftColor: 'rgba(255,255,255,0.15)',
    borderRightColor: 'rgba(0,0,0,0.3)',
    borderBottomColor: 'rgba(0,0,0,0.5)',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 0.5 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 60 },

  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    alignSelf: 'center',
  },
  heading: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  body: { fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 22, marginBottom: 8 },

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  progressLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },

  progressRingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  progressRing: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressRingFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  progressValue: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  progressGoal: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'Inter_700Bold',
  },
  progressHelp: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'Inter_400Regular',
  },

  benefitsList: { width: '100%' },
  sectionTitle: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
  },
  benefitText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_400Regular',
    flex: 1,
    lineHeight: 18,
  },

  ruleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  ruleIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(167,139,250,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(167,139,250,0.2)',
  },
  ruleBody: { flex: 1 },
  ruleTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
    marginBottom: 4,
  },
  ruleText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  checkboxCheckedTerms: { backgroundColor: '#34E6EC', borderColor: '#34E6EC' },
  checkLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_400Regular',
    flex: 1,
    lineHeight: 18,
  },

  termsRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  termsLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Inter_400Regular',
    flex: 1,
    lineHeight: 18,
  },

  submitBtn: {
    backgroundColor: '#4ADE80',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
    shadowColor: '#4ADE80',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#000',
    letterSpacing: 1,
  },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 24 },
  successTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: '#4ADE80',
    marginBottom: 16,
    textAlign: 'center',
  },
  successBody: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  doneCta: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  doneCtaText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#4ADE80',
    letterSpacing: 1.5,
  },
});
