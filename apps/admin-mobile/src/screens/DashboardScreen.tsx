import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppStackParamList } from '../navigation/types';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from '../context/AuthContext';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { LiveOpsMap } from '../components/LiveOpsMap';

const { supabase } = initializeSupabaseClient('native');

// Route list comes from src/navigation/types.ts, the same one App.tsx builds
// the navigator from. There used to be a private copy here that had already
// drifted — it was missing RevshareSettlement and CommanderManagement, so this
// screen could not navigate to two screens that exist. One list, one truth.
type DashboardNavProp = NativeStackNavigationProp<AppStackParamList, 'Dashboard'>;

interface KioskNode {
  id: string;
  tag_uid: string | null; // NULL until a physical tag is provisioned
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
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  // Open SOS count for the red banner (G Guardian). Polled so the banner is
  // right even if a push notification was missed.
  const [sosOpen, setSosOpen] = useState<{ unanswered: number; total: number }>({ unanswered: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const { data } = await supabase.rpc('guardian_open_sos').then((r: any) => r, () => ({ data: null }));
      if (cancelled || !Array.isArray(data)) return;
      setSosOpen({ unanswered: data.filter((d: any) => d.status === 'triggered').length, total: data.length });
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

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
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => deleteNode(item.id)}
              accessibilityLabel={`Delete ${item.location_name || 'this point'}`}
            >
              <Ionicons name="trash-outline" size={14} color="#FF8A8A" />
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.powerBtn, item.is_active ? styles.powerActive : styles.powerInactive]}
              onPress={() => toggleActive(item.id)}
              disabled={togglingId === item.id}
              accessibilityLabel={item.is_active ? 'Turn this point off' : 'Turn this point on'}
            >
              {togglingId === item.id ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name={item.is_active ? 'power' : 'power-outline'} size={14} color="#FFF" />
                  <Text style={styles.powerText}>{item.is_active ? 'On' : 'Off'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.locationName}>{item.location_name || 'Unnamed Location'}</Text>

        {item.merchants && (
          <Text style={styles.merchantName}>
            {item.merchants.name}
          </Text>
        )}

        <View style={styles.footer}>
          {/* No live node has a physical tag yet (tag_uid is NULL), and
              .slice on null crashed the whole dashboard on first open. */}
          <Text style={styles.meta}>{item.tag_uid ? `${item.tag_uid.slice(0, 12)}...` : 'No tag yet'}</Text>
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
        {sosOpen.total > 0 && (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); navigation.navigate('Sos'); }}
            style={{ backgroundColor: sosOpen.unanswered > 0 ? '#FF4D4D' : 'rgba(52,211,153,0.2)', borderRadius: 14, padding: 14, marginBottom: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Open SOS alerts"
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 15 }}>
              {sosOpen.unanswered > 0
                ? `SOS: ${sosOpen.unanswered} UNANSWERED - TAP NOW`
                : `SOS: ${sosOpen.total} being handled`}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>G-Touch Points</Text>
            <Text style={styles.headerMeta}>{nodes.length} deployed · {nodes.filter(n => n.is_active).length} active</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.headerActionsScroll} contentContainerStyle={styles.headerActions}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setViewMode(m => (m === 'list' ? 'map' : 'list'));
              }}
              style={styles.iconBtn}
              accessibilityLabel={viewMode === 'list' ? 'Show map' : 'Show list'}
            >
              <Ionicons name={viewMode === 'list' ? 'map-outline' : 'list-outline'} size={18} color={ACCENT} />
              <Text style={styles.iconCaption}>{viewMode === 'list' ? 'Map' : 'List'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('Approvals'); }}
              style={styles.iconBtn}
              accessibilityLabel="Approvals"
            >
              <Ionicons name="file-tray-full-outline" size={18} color={ACCENT} />
              <Text style={styles.iconCaption}>Approvals</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('GroundTransit'); }}
              style={styles.iconBtn}
              accessibilityLabel="Ground Transit"
            >
              <Ionicons name="airplane-outline" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Airport</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('ZoneRates'); }}
              style={styles.iconBtn}
              accessibilityLabel="Zone Rates"
            >
              {/* Jakob's: was 'map-outline', identical to this row's own
                  view-toggle button when it's showing "switch to map" --
                  two different buttons could render the same glyph. */}
              <Ionicons name="pricetag-outline" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Zone rates</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('Intelligence'); }}
              style={styles.iconBtn}
              accessibilityLabel="Talk to G"
            >
              <Ionicons name="chatbubbles-outline" size={18} color={ACCENT} />
              <Text style={styles.iconCaption}>Talk to G</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('PlatformControl'); }}
              style={styles.iconBtn}
              accessibilityLabel="Platform Control"
            >
              <Ionicons name="toggle-outline" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Switches</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('RegisterPuck'); }}
              style={styles.iconBtn}
              accessibilityLabel="Register a puck"
            >
              <Ionicons name="keypad-outline" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Add puck</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('IssueKeychain'); }}
              style={styles.iconBtn}
              accessibilityLabel="Issue Keychain"
            >
              <Ionicons name="key-outline" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Keychain</Text>
            </TouchableOpacity>
            {/* Hick's/Von Restorff: this row was 10 fixed-width (34px) icon
                buttons wide -- 412px minimum before the ScrollView above was
                added, in a header with ~335px available on a 375px phone.
                Delete Account (irreversible) carried the exact same muted,
                unlabeled 34px treatment as "Register Puck" (routine). Folded
                Delete Account and Sign Out into one labeled "More" menu, one
                tap further away and one Alert step further from accidental
                taps -- same confirmation dialog and delete_account call,
                untouched. */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Account', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign Out', onPress: signOut },
                  {
                    text: 'Delete Account', style: 'destructive',
                    onPress: () => {
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
                    },
                  },
                ]);
              }}
              style={styles.iconBtn}
              accessibilityLabel="Account options"
            >
              <Ionicons name="ellipsis-horizontal" size={18} color="rgba(255,255,255,0.75)" />
              <Text style={styles.iconCaption}>Account</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      {viewMode === 'map' ? (
        <View style={[styles.mapWrap, { paddingBottom: insets.bottom + 24 }]}>
          <LiveOpsMap nodes={nodes} />
        </View>
      ) : (
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
              <Ionicons name="radio-outline" size={44} color="rgba(255,255,255,0.75)" />
              <Text style={styles.emptyTitle}>No nodes deployed</Text>
              <Text style={styles.emptyDesc}>Tap "Add point" to set up a G-Touch Point</Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); navigation.navigate('TagMarker'); }}
        activeOpacity={0.85}
        accessibilityLabel="Add a G-Touch Point"
      >
        <LinearGradient colors={[ACCENT, ACCENT]} style={styles.fabInner}>
          <Ionicons name="add" size={22} color="#FFF" />
          <Text style={styles.fabText}>Add point</Text>
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    color: 'rgba(255,255,255,0.65)',
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
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#F1F5F9' },
  headerMeta: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2, fontWeight: '500' },
  headerActionsScroll: { flexGrow: 0 },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconBtn: {
    minWidth: 68,
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  iconCaption: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  list: { padding: 16, gap: 10 },
  mapWrap: { flex: 1, padding: 16 },
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
    flexDirection: 'row',
    gap: 5,
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  powerActive: { backgroundColor: `${ACCENT}40` },
  powerInactive: { backgroundColor: 'rgba(255,255,255,0.06)' },
  locationName: { fontSize: 15, fontWeight: '700', color: '#F1F5F9' },
  merchantName: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  footer: { flexDirection: 'row', gap: 14, marginTop: 6 },
  meta: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' },
  services: { flexDirection: 'row', gap: 5, marginTop: 8, flexWrap: 'wrap' },
  serviceTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  serviceText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  deleteBtn: {
    flexDirection: 'row',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,77,77,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontSize: 12, fontWeight: '700', color: '#FF8A8A' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 6,
  },
  emptyTitle: { fontSize: 15, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  emptyDesc: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  fab: { position: 'absolute', right: 24, height: 52, borderRadius: 26 },
  fabText: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  fabInner: {
    height: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 6,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});
