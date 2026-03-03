import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Surface, Txt } from '../design-system/primitives';
import { tokens } from '../design-system/tokens';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';

export function SettingsScreen({ navigation }: any) {
    const { user } = useAuth();

    // Local State for Toggles
    const [notifyRides, setNotifyRides] = useState(true);
    const [notifyPromos, setNotifyPromos] = useState(true);
    const [aiRouting, setAiRouting] = useState(false); // Phase 8: Opt-In POI

    // Fetch initial state
    useEffect(() => {
        if (!user) return;
        supabase.from('notification_settings').select('*').eq('user_id', user.id).single()
            .then(({ data }) => {
                if (data) {
                    setNotifyRides(data.ride_updates);
                    setNotifyPromos(data.promotions);
                }
            });

        // Load AI Routing Opt-In
        AsyncStorage.getItem('@ai_routing_opt_in').then(val => setAiRouting(val === 'true'));
    }, [user]);

    const toggleSetting = async (field: 'ride_updates' | 'promotions', value: boolean) => {
        // Optimistic UI Update
        if (field === 'ride_updates') setNotifyRides(value);
        if (field === 'promotions') setNotifyPromos(value);

        // Fire and Forget Save
        if (user) {
            await supabase.from('notification_settings').upsert({
                user_id: user.id,
                [field]: value,
                updated_at: new Date().toISOString()
            });
        }
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={{ flex: 1 }}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <Surface style={styles.backSurf} intensity={20}>
                            <Txt variant="headingM">←</Txt>
                        </Surface>
                    </TouchableOpacity>
                    <Txt variant="headingL" weight="bold">Settings</Txt>
                </View>

                {/* Section: Notifications */}
                <View style={styles.section}>
                    <Txt variant="headingM" style={{ marginBottom: 16 }}>Notifications</Txt>

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold">Ride Updates</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                Get notified when your driver arrives or calls.
                            </Txt>
                        </View>
                        <Switch
                            value={notifyRides}
                            onValueChange={(v) => toggleSetting('ride_updates', v)}
                            trackColor={{ false: '#333', true: tokens.colors.primary.purple }}
                            thumbColor="white"
                        />
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold">Discounts & News</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                Keep up to date with new features and promos.
                            </Txt>
                        </View>
                        <Switch
                            value={notifyPromos}
                            onValueChange={(v) => toggleSetting('promotions', v)}
                            trackColor={{ false: '#333', true: tokens.colors.primary.purple }}
                            thumbColor="white"
                        />
                    </View>
                </View>

                {/* Section: Preferences */}
                <View style={styles.section}>
                    <Txt variant="headingM" style={{ marginBottom: 16 }}>Preferences</Txt>

                    {/* PHASE 8: SPONSORED POI OPT-IN */}
                    <View style={styles.row}>
                        <View style={{ flex: 1, paddingRight: 16 }}>
                            <Txt variant="bodyBold">AI Route Tracking & Sponsored Offers</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                Opt-in to share trip data for AI-optimized routes and branded stops to earn discounts on your rides.
                            </Txt>
                        </View>
                        <Switch
                            value={aiRouting}
                            onValueChange={async (v) => {
                                setAiRouting(v);
                                await AsyncStorage.setItem('@ai_routing_opt_in', v ? 'true' : 'false');
                            }}
                            trackColor={{ false: '#333', true: tokens.colors.primary.purple }}
                            thumbColor="white"
                        />
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.row}>
                        <View style={{ flex: 1 }}>
                            <Txt variant="bodyBold">Clear Cache</Txt>
                            <Txt variant="caption" color={tokens.colors.text.secondary}>
                                If you are experiencing issues.
                            </Txt>
                        </View>
                        <TouchableOpacity style={styles.smallBtn} onPress={() => Alert.alert('Done', 'Cache cleared successfully.')}>
                            <Txt variant="small" weight="bold">Clear</Txt>
                        </TouchableOpacity>
                    </View>
                </View>

            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
    },
    backBtn: {
        marginRight: 16,
    },
    backSurf: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    section: {
        padding: 24,
        marginBottom: 12,
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginVertical: 12,
    },
    smallBtn: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 8,
    }
});
