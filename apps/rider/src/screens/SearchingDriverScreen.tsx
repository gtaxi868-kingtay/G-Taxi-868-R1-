import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../../shared/supabase';
import { cancelRide } from '../services/api';
import { fetchDriverDetails } from '../services/realtime';
import { tokens } from '../design-system/tokens';
import { Txt, Card } from '../design-system/primitives';

export function SearchingDriverScreen({ route, navigation }: any) {
    const { rideId, paymentMethod, destination, fare, pickup } = route.params;
    const insets = useSafeAreaInsets();
    const [dots, setDots] = useState('');
    const pulseAnim = new Animated.Value(0);

    useEffect(() => {
        // Pulse animation
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true })
            ])
        ).start();

        // Text dots animation
        const dotInterval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);

        // Timeout logic - 3 mins
        const timeout = setTimeout(async () => {
            await cancelRide(rideId);
            Alert.alert('Timeout', 'No drivers available. Please try again later.', [
                { text: 'OK', onPress: () => navigation.navigate('Home') }
            ]);
        }, 180000);

        // Realtime sub
        const sub = supabase.channel(`ride_${rideId}_search`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, async (payload) => {
                if (payload.new.status === 'assigned') {
                    const driverData = await fetchDriverDetails(payload.new.driver_id);
                    navigation.replace('ActiveRide', {
                        destination,
                        fare,
                        driver: driverData,
                        rideId,
                        paymentMethod: paymentMethod || payload.new.payment_method
                    });
                }
            })
            .subscribe();

        return () => {
            clearInterval(dotInterval);
            clearTimeout(timeout);
            sub.unsubscribe();
        };
    }, [rideId]);

    const handleCancel = async () => {
        await cancelRide(rideId);
        navigation.navigate('Home');
    };

    return (
        <View style={styles.overlay}>
            <Card style={styles.card} padding="xl" elevation="level3" radius="xl">

                <View style={styles.radarContainer}>
                    <Animated.View style={[
                        styles.radarPulse,
                        {
                            transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] }) }],
                            opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
                        }
                    ]} />
                    <View style={styles.radarCore}>
                        <Txt style={{ fontSize: 32 }}>🚘</Txt>
                    </View>
                </View>

                <Txt variant="headingL" weight="bold" color={tokens.colors.text.primary} style={{ marginTop: 40, marginBottom: 8 }}>
                    Finding your driver{dots}
                </Txt>
                <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ textAlign: 'center', marginBottom: 40 }}>
                    Broadcasting request to nearby partners. This usually takes 1-2 minutes.
                </Txt>

                <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                    <Txt variant="bodyBold" weight="bold" color={tokens.colors.status.error}>Cancel Request</Txt>
                </TouchableOpacity>
            </Card>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(5, 5, 10, 0.9)', justifyContent: 'center', paddingHorizontal: 20 },
    card: { alignItems: 'center', backgroundColor: tokens.colors.background.ambient },
    radarContainer: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
    radarPulse: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: tokens.colors.primary.purple, borderWidth: 1, borderColor: tokens.colors.primary.cyan },
    radarCore: { width: 80, height: 80, borderRadius: 40, backgroundColor: tokens.colors.background.base, borderWidth: 2, borderColor: tokens.colors.border.subtle, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    cancelBtn: { paddingVertical: 16, paddingHorizontal: 32, borderRadius: 30, backgroundColor: 'rgba(255, 69, 58, 0.1)' },
});
