import React, { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, View } from 'react-native';
import { GlassContainer } from '../components/GlassContainer';
import { VOICES } from '@gtaxi/design-system';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');
const ACCENT = VOICES.admin.accent;
const BG = VOICES.admin.bg;

export function RevshareSettlementScreen() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('ecosystem_pool_ledger').select('*').limit(20)
      .then(({ data }) => setData(data || []));
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Revshare Settlement</Text>
      
      <GlassContainer style={styles.glassCard}>
        <Text style={styles.cardTitle}>VAT Escrow Bucket</Text>
        <Text style={styles.cardDesc}>12.5% VAT has been successfully carved out from the gross pool before splitting the net fare.</Text>
      </GlassContainer>
      
      {data.map((item, idx) => (
        <GlassContainer key={idx} style={styles.glassCard}>
          <Text style={styles.itemText}>{item.beneficiary_type}: ${(item.amount_cents / 100).toFixed(2)} TTD</Text>
        </GlassContainer>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 20,
    marginTop: 40,
  },
  glassCard: {
    marginBottom: 16,
  },
  cardTitle: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cardDesc: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  itemText: {
    color: '#fff',
    fontSize: 16,
  },
});
