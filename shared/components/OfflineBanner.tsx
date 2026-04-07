import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { Text } from 'react-native';

export function OfflineBanner() {
    const [isOffline, setIsOffline] = useState(false);
    const slideAnim = React.useRef(new Animated.Value(-100)).current;

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener(state => {
            const offline = state.isConnected === false;
            setIsOffline(offline);

            Animated.timing(slideAnim, {
                toValue: offline ? 0 : -100,
                duration: 300,
                useNativeDriver: true,
            }).start();
        });

        return () => unsubscribe();
    }, []);

    return (
        <Animated.View style={[s.banner, { transform: [{ translateY: slideAnim }] }]}>
            <View style={s.content}>
                <Ionicons name="cloud-offline" size={20} color="#FFF" />
                <Text style={s.text}>Offline: Check your internet connection</Text>
            </View>
        </Animated.View>
    );
}

const s = StyleSheet.create({
    banner: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: '#EF4444',
        paddingTop: 50, // Typical status bar height
        paddingBottom: 12,
        paddingHorizontal: 20,
        zIndex: 9999,
        elevation: 10,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: 'bold',
        marginLeft: 10,
    },
});
