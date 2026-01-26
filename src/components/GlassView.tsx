import React from 'react';
import { View, StyleSheet, ViewStyle, Platform, StyleProp } from 'react-native';
import { theme } from '../theme';

interface GlassViewProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    intensity?: 'light' | 'medium' | 'heavy';
}

export const GlassView = ({ children, style, intensity = 'medium' }: GlassViewProps) => {
    return (
        <View style={[styles.glass, styles[intensity], style]}>
            <View style={styles.highlight} />
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    glass: {
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
        } : {}),
    },
    light: {
        backgroundColor: theme.colors.glass.background,
    },
    medium: {
        backgroundColor: theme.colors.glass.background,
    },
    heavy: {
        backgroundColor: theme.colors.glass.backgroundDark,
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
