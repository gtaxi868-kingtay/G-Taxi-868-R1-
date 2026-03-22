import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';


const { width, height } = Dimensions.get('window');

export function PremiumRainBackground() {
    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#07050F', '#110E22', '#1E1040']}
                style={StyleSheet.absoluteFill}
            />
            {/* Ambient Glows */}
            <View style={[styles.glow, { top: '10%', left: '20%', backgroundColor: 'rgba(124,58,237,0.15)' }]} />
            <View style={[styles.glow, { bottom: '20%', right: '10%', backgroundColor: 'rgba(16,185,129,0.1)' }]} />

            <BlurView tint="dark" intensity={10} style={StyleSheet.absoluteFill} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#07050F',
    },
    glow: {
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: 150,
        // filter: 'blur(60px)', // web only
        opacity: 0.4,
    }
});
