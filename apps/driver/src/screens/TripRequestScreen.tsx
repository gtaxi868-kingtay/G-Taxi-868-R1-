import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { acceptRide, declineRide } from '../services/api';
// import { Audio } from 'expo-av'; // Sound alert would be good

export function TripRequestScreen({ navigation, route }: any) {
    const { offer } = route.params || {};
    const { driver } = useAuth();
    const [timeLeft, setTimeLeft] = useState(15);
    const [isHandling, setIsHandling] = useState(false);

    // 15-second auto-decline timer
    useEffect(() => {
        if (timeLeft <= 0) {
            if (!isHandling) handleDecline(true);
            return;
        }
        const timer = setTimeout(() => setTimeLeft(l => l - 1), 1000);
        return () => clearTimeout(timer);
    }, [timeLeft, isHandling]);

    const handleAccept = async () => {
        if (!offer || !driver || isHandling) return;
        setIsHandling(true);

        console.log('Accepting offer:', offer.id);
        const { error } = await acceptRide(offer.ride_id, driver.id);

        if (error) {
            alert('Offer expired or no longer available.');
            navigation.goBack();
        } else {
            // Success - Go to Active Trip
            navigation.replace('ActiveTrip', { rideId: offer.ride_id });
        }
    };

    const handleDecline = async (auto = false) => {
        if (!offer || isHandling) return;
        setIsHandling(true);
        console.log(auto ? 'Auto-declining offer' : 'Manually declining offer');

        await declineRide(offer.id);
        navigation.goBack();
    };

    return (
        <View style={styles.container}>
            <View style={styles.card}>
                <View style={styles.timerRing}>
                    <Text style={styles.timerText}>{timeLeft}s</Text>
                </View>

                <Text style={styles.title}>New Trip Request!</Text>
                <Text style={styles.distance}>{(offer?.distance_meters / 1000).toFixed(1)} km away</Text>

                <View style={styles.actions}>
                    <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={() => handleDecline(false)} disabled={isHandling}>
                        <Text style={styles.btnText}>Decline</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={handleAccept} disabled={isHandling}>
                        <Text style={styles.btnText}>ACCEPT</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)', // Overlay style
        justifyContent: 'center',
        padding: 24,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 32,
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    distance: {
        fontSize: 18,
        color: '#666',
        marginBottom: 32,
    },
    timerRing: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 4,
        borderColor: '#3b82f6',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    timerText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#3b82f6',
    },
    actions: {
        flexDirection: 'row',
        gap: 16,
        width: '100%',
    },
    btn: {
        flex: 1,
        padding: 20,
        borderRadius: 12,
        alignItems: 'center',
    },
    acceptBtn: {
        backgroundColor: '#22c55e',
    },
    declineBtn: {
        backgroundColor: '#ef4444',
    },
    btnText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 18,
    }
});
