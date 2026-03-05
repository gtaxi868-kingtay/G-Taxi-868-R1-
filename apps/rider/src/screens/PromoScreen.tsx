import React, { useState } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Surface, Txt, Card } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export function PromoScreen({ navigation }: any) {
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [appliedPromos, setAppliedPromos] = useState<any[]>([]);
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const handleApplyCode = async () => {
        if (!code.trim()) {
            Alert.alert('Enter a Code', 'Please enter a promo code to apply.');
            return;
        }

        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('promo_codes')
                .select('*')
                .eq('code', code.trim().toUpperCase())
                .eq('is_active', true)
                .single();

            if (error || !data) {
                Alert.alert('Invalid Code', 'This promo code is not valid or has expired.');
                setLoading(false);
                return;
            }

            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                Alert.alert('Expired', 'This promo code has expired.');
                setLoading(false);
                return;
            }

            if (data.max_uses && data.current_uses >= data.max_uses) {
                Alert.alert('Limit Reached', 'This promo code has reached its usage limit.');
                setLoading(false);
                return;
            }

            setAppliedPromos(prev => [...prev, data]);
            setCode('');
            Alert.alert('Success!', `Promo code applied: ${data.discount_percent ? data.discount_percent + '% off' : '$' + (data.discount_flat_cents / 100).toFixed(2) + ' off'} your next ride!`);
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[tokens.colors.background.base, '#0A0A14']}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Txt variant="headingL">←</Txt>
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold">Promotions</Txt>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <Txt variant="bodyBold" style={styles.sectionLabel}>Enter Promo Code</Txt>
                <Card padding="md" style={styles.inputCard}>
                    <View style={styles.inputRow}>
                        <TextInput
                            style={styles.input}
                            placeholder="PROMO CODE"
                            placeholderTextColor="rgba(255,255,255,0.3)"
                            value={code}
                            onChangeText={(text) => setCode(text.toUpperCase())}
                            autoCapitalize="characters"
                            returnKeyType="done"
                            onSubmitEditing={handleApplyCode}
                        />
                        <TouchableOpacity
                            style={[styles.applyBtn, !code.trim() && styles.applyBtnDisabled]}
                            onPress={handleApplyCode}
                            disabled={loading || !code.trim()}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Txt variant="bodyBold" color="#fff">Apply</Txt>
                            )}
                        </TouchableOpacity>
                    </View>
                </Card>

                {appliedPromos.length > 0 && (
                    <View style={styles.appliedSection}>
                        <Txt variant="bodyBold" style={styles.sectionLabel}>Active Promotions</Txt>
                        {appliedPromos.map((promo, index) => (
                            <Card key={promo.id || index} padding="md" style={styles.promoCard}>
                                <View style={styles.promoRow}>
                                    <View style={styles.promoBadge}>
                                        <Ionicons name="gift-outline" size={28} color={tokens.colors.primary.purple} />
                                    </View>
                                    <View style={styles.promoInfo}>
                                        <Txt variant="bodyBold">{promo.code}</Txt>
                                        <Txt variant="caption" color={tokens.colors.text.secondary}>
                                            {promo.discount_percent
                                                ? `${promo.discount_percent}% off your next ride`
                                                : `$${(promo.discount_flat_cents / 100).toFixed(2)} off your next ride`
                                            }
                                        </Txt>
                                    </View>
                                    <Txt variant="caption" color={tokens.colors.status.success}>Active</Txt>
                                </View>
                            </Card>
                        ))}
                    </View>
                )}

                {appliedPromos.length === 0 && (
                    <View style={styles.emptyState}>
                        <Ionicons name="ticket-outline" size={48} color={tokens.colors.text.tertiary} style={{ marginBottom: 16 }} />
                        <Txt variant="headingM" center>No promotions yet</Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} center style={{ marginTop: 8 }}>
                            Enter a promo code above to get discounts on your rides.
                        </Txt>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.colors.background.base },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    scrollView: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
    sectionLabel: { marginBottom: 12, marginTop: 8 },
    inputCard: { marginBottom: 24 },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    input: { flex: 1, height: 48, color: tokens.colors.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 2 },
    applyBtn: { backgroundColor: tokens.colors.primary.purple, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
    applyBtnDisabled: { opacity: 0.4 },
    appliedSection: { marginTop: 8 },
    promoCard: { marginBottom: 12 },
    promoRow: { flexDirection: 'row', alignItems: 'center' },
    promoBadge: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
    promoInfo: { flex: 1 },
    emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
});
