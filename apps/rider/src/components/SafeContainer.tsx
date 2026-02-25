// Safe Container Component - Proper safe area handling for all device sizes
// Fixes buttons being cut off and respects notches, home indicators

import React from 'react';
import {
    View,
    StyleSheet,
    Platform,
    StatusBar,
    Dimensions,
    ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SafeContainerProps {
    children: React.ReactNode;
    style?: ViewStyle;
    edges?: ('top' | 'bottom' | 'left' | 'right')[];
    backgroundColor?: string;
}

export function SafeContainer({
    children,
    style,
    edges = ['top', 'bottom'],
    backgroundColor = '#0A0A15',
}: SafeContainerProps) {
    const insets = useSafeAreaInsets();

    const paddingStyle: ViewStyle = {
        paddingTop: edges.includes('top') ? insets.top : 0,
        paddingBottom: edges.includes('bottom') ? Math.max(insets.bottom, 20) : 0,
        paddingLeft: edges.includes('left') ? insets.left : 0,
        paddingRight: edges.includes('right') ? insets.right : 0,
    };

    return (
        <View style={[styles.container, { backgroundColor }, paddingStyle, style]}>
            {children}
        </View>
    );
}

// Bottom Sheet Safe Container - For bottom cards that need home indicator space
interface BottomSheetContainerProps {
    children: React.ReactNode;
    style?: ViewStyle;
}

export function BottomSheetContainer({
    children,
    style,
}: BottomSheetContainerProps) {
    const insets = useSafeAreaInsets();
    const bottomPadding = Math.max(insets.bottom, 24);

    return (
        <View style={[styles.bottomSheet, { paddingBottom: bottomPadding }, style]}>
            {/* Handle indicator */}
            <View style={styles.handleContainer}>
                <View style={styles.handle} />
            </View>
            {children}
        </View>
    );
}

// Floating Action Container - For buttons at bottom of screen
interface FloatingActionContainerProps {
    children: React.ReactNode;
    style?: ViewStyle;
}

export function FloatingActionContainer({
    children,
    style,
}: FloatingActionContainerProps) {
    const insets = useSafeAreaInsets();
    const bottomPadding = Math.max(insets.bottom, 16);

    return (
        <View style={[styles.floatingContainer, { paddingBottom: bottomPadding }, style]}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    bottomSheet: {
        backgroundColor: 'rgba(20, 20, 35, 0.95)',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 8,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },
    floatingContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 20,
        paddingTop: 16,
        backgroundColor: 'rgba(10, 10, 21, 0.9)',
    },
});

// Get screen dimensions accounting for safe areas
export function useScreenDimensions() {
    const { width, height } = Dimensions.get('window');
    const insets = useSafeAreaInsets();

    return {
        width,
        height,
        safeWidth: width - insets.left - insets.right,
        safeHeight: height - insets.top - insets.bottom,
        insets,
    };
}
