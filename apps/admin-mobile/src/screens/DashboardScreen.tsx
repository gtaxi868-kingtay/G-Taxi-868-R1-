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
import { SURFACE, VOICES, ANIMATION } from '@gtaxi/design-system';
import { elevationGlow, glassSurface, ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const { supabase } = initializeSupabaseClient('native');

type RootStackParamList = {
  Dashboard: undefined;
  TagMarker: undefined;
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

export function DashboardScreen({ navigation }: { navigation: DashboardNavProp }) {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const [nodes, setNodes] = useState<KioskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('admin_manage_nodes', {
        body: { action: 'list' },
      });
      if (error) throw error;
      if (data?.success) {
        setNodes(data.nodes || []);
      }
    } catch (err) {
      // silent
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
      const { data, error } = await supabase.functions.invoke('admin_manage_nodes', {
        body: { action: 'toggle_active', node_id: nodeId },
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
              const { data, error } = await supabase.functions.invoke('admin_manage_nodes', {
                body: { action: 'delete', node_id: nodeId },
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

  const getNodeTypeLabel = (node: KioskNode) => {
    if (node.merchant_id) return { label: 'Business Spot', icon: 'storefront' as const, color: ACCENT };
    return { label: 'Taxi Stand', icon: 'car' as const, color: ACCENT };
  };

  const renderNode = ({ item }: { item: KioskNode }) => {
    const typeInfo = getNodeTypeLabel(item);
    return (
      <View style={[styles.nodeCard, glassSurface(0.1)]}>
        <View style={styles.nodeHeader}>
          <View style={[styles.typeBadge, { backgroundColor: `${typeInfo.color}15`, ...ghostBorder(0.15) }]}>
            <Ionicons name={typeInfo.icon} size={14} color={typeInfo.color} />
            <Text style={[styles.typeLabel, { color: typeInfo.color }]}>{typeInfo.label}</Text>
          </View>
          <TouchableOpacity
            style={[styles.activeToggle, item.is_active ? styles.activeOn : styles.activeOff]}
            onPress={() => toggleActive(item.id)}
            disabled={togglingId === item.id}
          >
            {togglingId === item.id ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name={item.is_active ? 'power' : 'power-outline'} size={16} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.locationName}>{item.location_name || 'Unnamed Location'}</Text>

        {item.merchants && (
          <Text style={styles.merchantName}>
            <Ionicons name="business-outline" size={12} color="rgba(255,255,255,0.4)" /> {item.merchants.name}
          </Text>
        )}

        <View style={styles.nodeMeta}>
          <Text style={styles.metaText}>
            <Ionicons name="key-outline" size={11} color="rgba(255,255,255,0.3)" /> {item.tag_uid.slice(0, 12)}...
          </Text>
          {item.lat && item.lng ? (
            <Text style={styles.metaText}>{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</Text>
          ) : null}
        </View>

        <View style={styles.serviceRow}>
          {item.default_services?.map(s => (
            <View key={s} style={styles.serviceTag}>
              <Text style={styles.serviceText}>{s}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteNode(item.id)}>
          <Ionicons name="trash-outline" size={16} color="#FF4D4D" />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <LinearGradient colors={[SURFACE.base, '#1A0A0A']} style={styles.container}>
        <View style={[styles.center, { paddingTop: insets.top + 80 }]}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Scanning network...</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[SURFACE.base, '#1A0A0A']} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={styles.headerTitle}>Kiosk Nodes</Text>
          <Text style={styles.headerCount}>{nodes.length} deployed</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={signOut} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={nodes}
        keyExtractor={item => item.id}
        renderItem={renderNode}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="radio-outline" size={48} color="rgba(255,255,255,0.15)" />
            <Text style={styles.emptyText}>No nodes deployed</Text>
            <Text style={styles.emptySubtext}>Tap + to provision a puck</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('TagMarker'); }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={[ACCENT, ACCENT + 'CC']} style={styles.fabGradient}>
          <Ionicons name="add" size={28} color="#FFF" />
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 12 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 12,
    ...ghostBorder(0.15),
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#F1F5F9' },
  headerCount: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 12 },
  logoutBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  nodeCard: {
    borderRadius: 20, overflow: 'hidden', padding: 18,
  },
  nodeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  typeLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  activeToggle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  activeOn: { backgroundColor: 'rgba(16,185,129,0.3)' },
  activeOff: { backgroundColor: 'rgba(255,255,255,0.08)' },
  locationName: { fontSize: 16, fontWeight: '700', color: '#F1F5F9' },
  merchantName: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  nodeMeta: { flexDirection: 'row', gap: 16, marginTop: 8 },
  metaText: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  serviceRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  serviceTag: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  serviceText: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 },
  deleteBtn: { position: 'absolute', top: 18, right: 56, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,77,77,0.1)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyText: { fontSize: 16, color: 'rgba(255,255,255,0.3)', fontWeight: '600' },
  emptySubtext: { fontSize: 13, color: 'rgba(255,255,255,0.2)' },
  fab: { position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28, ...elevationGlow() },
  fabGradient: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
