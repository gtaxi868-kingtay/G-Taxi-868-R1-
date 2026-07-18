import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';

const { supabase } = initializeSupabaseClient('native');

type RootStackParamList = {
  Dashboard: undefined;
  TagMarker: undefined;
  RegisterPuck: undefined;
  Intelligence: undefined;
};

type DashboardNavProp = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;

interface KioskNode {
  id: string;
  tag_uid: string;
  merchant_id: string | null;
  location_name: string;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  default_services: string[];
  created_at: string;
  merchants: { id: string; name: string; category: string } | null;
}

const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

export function DashboardScreen({ navigation }: { navigation: DashboardNavProp }) {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const [nodes, setNodes] = useState<KioskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action: 'manage_nodes', action_type: 'list' },
      });
      if (error) throw error;
      if (data?.success) {
        setNodes(data.nodes || []);
      }
    } catch (err) {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchNodes();
  };

  const toggleActive = async (nodeId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTogglingId(nodeId);
    try {
      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action: 'manage_nodes', action_type: 'toggle_active', node_id: nodeId },
      });
      if (error) throw error;
      if (data?.success) {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, is_active: data.node.is_active } : n));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle node';
      Alert.alert('Error', message);
    } finally {
      setTogglingId(null);
    }
  };

  const deleteNode = (nodeId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Delete Node',
      'This will permanently remove this kiosk node. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke('admin', {
                body: { action: 'manage_nodes', action_type: 'delete', node_id: nodeId },
              });
              if (error) throw error;
              if (data?.success) {
                setNodes(prev => prev.filter(n => n.id !== nodeId));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Failed to delete node';
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  const getNodeTypeIcon = (node: KioskNode) => {
    if (node.merchant_id) return 'storefront';
    return 'car';
  };

  const renderNode = ({ item }: { item: KioskNode }) => {
    const isBusiness = !!item.merchant_id;
    return (
      <View style={styles.nodeCard}>
        <View style={styles.nodeHeader}>
          <View style={[styles.typeBadge, { backgroundColor: `${ACCENT}15` }]}>
            <Ionicons name={isBusiness ? 'storefront' : 'car'} size={12} color={ACCENT} />
            <Text style={[styles.typeLabel, { color: ACCENT }]}>
              {isBusiness ? 'BUSINESS' : 'TAXI STAND'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.powerBtn, item.is_active ? styles.powerActive : styles.powerInactive]}
            onPress={() => toggleActive(item.id)}
            disabled={togglingId === item.id}
          >
            {togglingId === item.id ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name={item.is_active ? 'power' : 'power-outline'} size={14} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.locationName}>{item.location_name || 'Unnamed Location'}</Text>

        {item.merchants && (
          <Text style={styles.merchantName}>
            {item.merchants.name}
          </Text>
        )}

        <View style={styles.footer}>
          <Text style={styles.meta}>{item.tag_uid.slice(0, 12)}...</Text>
          {item.lat && item.lng ? (
            <Text style={styles.meta}>{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</Text>
          ) : null}
        </View>

        <View style={styles.services}>
          {item.default_services?.map(s => (
            <View key={s} style={styles.serviceTag}>
              <Text style={styles.serviceText}>{s}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteNode(item.id)}>
          <Ionicons name="trash-outline" size={15} color="#FF4D4D" />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <LinearGradient colors={[BG, '#0B1120']} style={styles.container}>
        <View style={[styles.center, { paddingTop: insets.top + 80 }]}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Scanning network...</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG, '#0B1120']} style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>G-Touch Points</Text>
            <Text style={styles.headerMeta}>{nodes.length} deployed · {nodes.filter(n => n.is_active).length} active</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('Intelligence'); }}
              style={styles.iconBtn}
              accessibilityLabel="Talk to G"
            >
              <Ionicons name="chatbubbles-outline" size={18} color={ACCENT} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('RegisterPuck'); }}
              style={styles.iconBtn}
            >
              <Ionicons name="keypad-outline" size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Delete Account',
                  'Permanently delete your account and all associated data? This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete Permanently', style: 'destructive',
                      onPress: async () => {
                        try {
                          const { error } = await supabase.functions.invoke('delete_account');
                          if (error) throw error;
                          await signOut();
                        } catch (err: any) {
                          Alert.alert('Error', err?.message || 'Could not delete account.');
                        }
                      },
                    },
                  ]
                );
              }}
              style={styles.iconBtn}
            >
              <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
            <TouchableOpacity onPress={signOut} style={styles.iconBtn}>
              <Ionicons name="log-out-outline" size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <FlatList
        data={nodes}
        keyExtractor={item => item.id}
        renderItem={renderNode}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ACCENT}
            progressBackgroundColor={VOICES.admin.surface}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.12)" />
            <Text style={styles.emptyTitle}>No nodes deployed</Text>
            <Text style={styles.emptyDesc}>Tap + to provision a G-Touch Point</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('TagMarker'); }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={[ACCENT, ACCENT]} style={styles.fabInner}>
          <Ionicons name="add" size={26} color="#FFF" />
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 12,
    fontWeight: '500',
  },
  headerPad: {
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#F1F5F9' },
  headerMeta: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: 16, gap: 10 },
  nodeCard: {
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  nodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  powerBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerActive: { backgroundColor: `${ACCENT}40` },
  powerInactive: { backgroundColor: 'rgba(255,255,255,0.06)' },
  locationName: { fontSize: 15, fontWeight: '700', color: '#F1F5F9' },
  merchantName: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  footer: { flexDirection: 'row', gap: 14, marginTop: 6 },
  meta: { fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' },
  services: { flexDirection: 'row', gap: 5, marginTop: 8, flexWrap: 'wrap' },
  serviceTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  serviceText: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  deleteBtn: {
    position: 'absolute',
    top: 14,
    right: 50,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,77,77,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 6,
  },
  emptyTitle: { fontSize: 15, color: 'rgba(255,255,255,0.25)', fontWeight: '600' },
  emptyDesc: { fontSize: 12, color: 'rgba(255,255,255,0.18)' },
  fab: { position: 'absolute', right: 24, width: 52, height: 52, borderRadius: 26 },
  fabInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});
