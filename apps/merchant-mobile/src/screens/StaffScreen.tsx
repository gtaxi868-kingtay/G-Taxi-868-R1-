import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { initializeSupabaseClient } from '@gtaxi/core';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';
import { useAuth } from '../context/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const { supabase } = initializeSupabaseClient('native');

interface StaffMember {
  id: string;
  user_id: string | null;
  name: string;
  role: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export function StaffScreen({ navigation }: { navigation: NativeStackNavigationProp<any> }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [sending, setSending] = useState(false);

  const resolveMerchantId = useCallback(async () => {
    if (!user) return null;
    const { data: merchant } = await supabase.from('merchants').select('id').eq('created_by', user.id).maybeSingle();
    if (merchant?.id) return merchant.id;
    const { data: staff } = await supabase.from('merchant_staff').select('merchant_id').eq('user_id', user.id).maybeSingle();
    return staff?.merchant_id || null;
  }, [user]);

  const loadStaff = useCallback(async () => {
    const mId = await resolveMerchantId();
    if (!mId) { setLoading(false); return; }
    setMerchantId(mId);

    const { data, error } = await supabase
      .from('merchant_staff')
      .select('id, user_id, name, role, phone, is_active, created_at')
      .eq('merchant_id', mId)
      .order('created_at', { ascending: false });

    if (error) {
      Alert.alert('Error', 'Could not load staff members.');
    } else {
      setStaff(data || []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [resolveMerchantId]);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const handleInvite = async () => {
    if (!inviteName.trim()) {
      Alert.alert('Required', 'Staff member name is required.');
      return;
    }
    setSending(true);
    const { error } = await supabase.from('merchant_staff').insert({
      merchant_id: merchantId,
      name: inviteName.trim(),
      role: inviteRole.trim() || 'staff',
      phone: invitePhone.trim() || null,
      is_active: true,
    });
    setSending(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setModalVisible(false);
    setInviteName('');
    setInvitePhone('');
    setInviteRole('');
    await loadStaff();
  };

  const toggleActive = async (member: StaffMember) => {
    const { error } = await supabase
      .from('merchant_staff')
      .update({ is_active: !member.is_active })
      .eq('id', member.id);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setStaff(prev => prev.map(s => s.id === member.id ? { ...s, is_active: !s.is_active } : s));
    }
  };

  const confirmRemove = (member: StaffMember) => {
    Alert.alert('Remove Staff', `Remove ${member.name} from your team?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('merchant_staff').delete().eq('id', member.id);
          if (error) { Alert.alert('Error', error.message); return; }
          setStaff(prev => prev.filter(s => s.id !== member.id));
        },
      },
    ]);
  };

  const renderStaff = ({ item }: { item: StaffMember }) => (
    <View style={[s.staffRow, glassSurface(0.12), ghostBorder(0.12)]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={s.staffInfo}>
        <Text style={s.staffName}>{item.name}</Text>
        <Text style={s.staffRole}>{item.role || 'Staff'}{item.phone ? ` · ${item.phone}` : ''}</Text>
      </View>
      <View style={s.staffActions}>
        <TouchableOpacity
          style={[s.toggleBtn, { backgroundColor: item.is_active ? VOICES.merchant.accent + '26' : 'rgba(239,68,68,0.15)' }]}
          onPress={() => toggleActive(item)}
        >
          <Text style={[s.toggleText, { color: item.is_active ? VOICES.merchant.accent : '#EF4444' }]}>
            {item.is_active ? 'Active' : 'Inactive'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => confirmRemove(item)} style={s.iconBtn}>
          <Ionicons name="trash-outline" size={16} color="#EF4444" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#E9F5F3" />
        </TouchableOpacity>
        <Text style={s.title}>Staff</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} style={s.addBtn}>
          <Ionicons name="add" size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={VOICES.merchant.accent} style={{ marginTop: 40 }} />
      ) : staff.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="people-outline" size={64} color="rgba(255,255,255,0.6)" />
          <Text style={s.emptyTitle}>No Staff Yet</Text>
          <Text style={s.emptyDesc}>Invite team members to help manage orders and appointments.</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => setModalVisible(true)}>
            <Ionicons name="add" size={18} color={VOICES.merchant.accent} />
            <Text style={s.emptyBtnText}>Add Staff Member</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={item => item.id}
          renderItem={renderStaff}
          contentContainerStyle={s.list}
          onRefresh={() => { setRefreshing(true); loadStaff(); }}
          refreshing={refreshing}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <LinearGradient colors={[SURFACE.base, '#1C1510']} style={StyleSheet.absoluteFillObject} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Add Staff Member</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={s.modalClose}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>Full Name *</Text>
            <TextInput style={s.input} value={inviteName} onChangeText={setInviteName} placeholder="e.g. Jane Doe" placeholderTextColor="rgba(255,255,255,0.2)" />

            <Text style={s.fieldLabel}>Phone</Text>
            <TextInput style={s.input} value={invitePhone} onChangeText={setInvitePhone} placeholder="+1 868 xxx xxxx" placeholderTextColor="rgba(255,255,255,0.2)" keyboardType="phone-pad" />

            <Text style={s.fieldLabel}>Role</Text>
            <TextInput style={s.input} value={inviteRole} onChangeText={setInviteRole} placeholder="e.g. Cashier, Barber, Manager" placeholderTextColor="rgba(255,255,255,0.2)" />

            <TouchableOpacity style={[s.saveBtn, sending && s.saveBtnDisabled]} onPress={handleInvite} disabled={sending}>
              {sending ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={s.saveBtnText}>Add Staff Member</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: SURFACE.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: VOICES.merchant.accent, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 20, paddingBottom: 48 },
  staffRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 16, marginBottom: 10, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: VOICES.merchant.accent + '26', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  staffInfo: { flex: 1, minWidth: 0 },
  staffName: { fontSize: 15, fontWeight: '600', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  staffRole: { fontSize: 12, color: VOICES.merchant.textMuted, marginTop: 2, fontFamily: 'Manrope' },
  staffActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  toggleText: { fontSize: 11, fontWeight: '700', fontFamily: 'Manrope' },
  iconBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#E9F5F3', marginTop: 16, fontFamily: 'SpaceGrotesk' },
  emptyDesc: { fontSize: 14, color: VOICES.merchant.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 20, fontFamily: 'Manrope' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: VOICES.merchant.accent + '22' },
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: VOICES.merchant.accent, fontFamily: 'SpaceGrotesk' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#E9F5F3', fontFamily: 'SpaceGrotesk' },
  modalClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' },
  modalScroll: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 20, fontFamily: 'Manrope' },
  input: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, color: '#E9F5F3', fontSize: 15, fontFamily: 'Manrope' },
  saveBtn: { backgroundColor: VOICES.merchant.accent, borderRadius: 16, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 32 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: '800', color: '#000', fontFamily: 'SpaceGrotesk' },
});
