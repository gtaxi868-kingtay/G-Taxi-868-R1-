import React from 'react';
import { View, StyleSheet, ViewStyle, Platform, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { theme } from '../theme';
import { liquidGlass } from '@gtaxi/design-system/utils/style-rules';

interface GlassViewProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    intensity?: 'light' | 'medium' | 'heavy';
}

export const GlassView = ({ children, style, intensity = 'medium' }: GlassViewProps) => {
    const isWeb = Platform.OS === 'web';
    
    // For Native we use BlurView, for web we use the liquidGlass CSS rules
    if (!isWeb) {
        return (
            <BlurView 
                intensity={intensity === 'heavy' ? 80 : intensity === 'medium' ? 50 : 20} 
                tint="dark"
                style={[styles.glassNative, style]}
            >
                <View style={styles.highlight} />
                {children}
            </BlurView>
        );
    }

    return (
        <View style={[styles.glassWeb, style]}>
            <View style={styles.highlight} />
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    glassNative: {
        overflow: 'hidden',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
    },
    glassWeb: {
        ...liquidGlass(0.05, 20),
    },
    highlight: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: theme.colors.glass.highlight,
        zIndex: 1,
    },
});
