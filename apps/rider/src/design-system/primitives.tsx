import React from 'react';
import { View, Text as RNText, TouchableOpacity, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { tokens } from './tokens';

// --- PRIMITIVES ---

// 1. TXT (Typography - Calm & Confident)
interface TxtProps {
    variant?: keyof typeof tokens.typography.sizes;
    color?: string;
    weight?: keyof typeof tokens.typography.weights;
    center?: boolean;
    style?: StyleProp<TextStyle>;
    children: React.ReactNode;
    numberOfLines?: number;
}

export const Txt = ({
    variant = 'bodyReg',
    color = tokens.colors.text.primary,
    weight,
    center,
    style,
    children,
    numberOfLines
}: TxtProps) => {
    const size = tokens.typography.sizes[variant] || 15;

    // Checklist #5: Hierarchy - Title -> Value -> Metadata
    const defaultWeights: Record<string, string> = {
        displayXL: '700', // Calm, not heavy
        headingL: '600',
        headingM: '600',
        bodyBold: '600',
        bodyReg: '400',
        caption: '400',
        small: '400'
    };

    const fontWeight = weight ? tokens.typography.weights[weight] : defaultWeights[variant] as any;
    const letterSpacing = tokens.typography.letterSpacing.normal;

    return (
        <RNText
            style={[
                { color, fontSize: size, fontWeight, textAlign: center ? 'center' : 'auto', letterSpacing },
                style
            ]}
            numberOfLines={numberOfLines}
        >
            {children}
        </RNText>
    );
};

// 2. SURFACE (Glass Base - "Satin")
interface SurfaceProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    intensity?: number;
    noBorder?: boolean;
}

export const Surface = ({ children, style, intensity = 40, noBorder = false }: SurfaceProps) => {
    // Checklist #2: Material - Soft, Diffused
    const borderStyle = noBorder ? {} : {
        borderColor: tokens.colors.glass.stroke,
        borderWidth: 1,
        borderTopColor: tokens.colors.glass.strokeHighlight,
    };

    return (
        <BlurView intensity={intensity} tint="dark" style={[styles.overflowHidden, styles.surfaceBase, borderStyle, style]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.colors.glass.fill }]} />
            {children}
        </BlurView>
    );
};

// 3. CARD (Level 2 Elevation)
interface CardProps extends SurfaceProps {
    padding?: keyof typeof tokens.layout.spacing;
    radius?: keyof typeof tokens.layout.radius;
    elevation?: keyof typeof tokens.elevation;
}

export const Card = ({ children, style, padding = 'md', radius = 'l', elevation = 'level2', ...props }: CardProps) => {
    return (
        <View style={[tokens.elevation[elevation], { borderRadius: tokens.layout.radius[radius] }]}>
            <Surface
                style={[
                    {
                        padding: tokens.layout.spacing[padding],
                        borderRadius: tokens.layout.radius[radius],
                        width: '100%',
                    },
                    style
                ]}
                {...props}
            >
                {children}
            </Surface>
        </View>
    );
};

// 4. BTN (Action Authority)
interface BtnProps {
    onPress?: () => void;
    title: string;
    variant?: 'primary' | 'glass' | 'ghost';
    icon?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    disabled?: boolean;
    fullWidth?: boolean;
}

export const Btn = ({ onPress, title, variant = 'primary', icon, style, disabled, fullWidth }: BtnProps) => {
    const radius = tokens.layout.radius.full;
    const height = 52; // Slightly smaller for "Refined" feel

    // Primary: Focus Elevation + Gradient
    if (variant === 'primary') {
        return (
            <TouchableOpacity
                activeOpacity={0.8}
                onPress={onPress}
                disabled={disabled}
                style={[
                    styles.btnContainer,
                    fullWidth && { width: '100%' },
                    tokens.elevation.level3, // Focus Elevator
                    style
                ]}
            >
                <LinearGradient
                    colors={[tokens.colors.primary.gradient[0], tokens.colors.primary.gradient[1]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.btnInner, { borderRadius: radius, height }]}
                >
                    {icon && <View style={styles.iconSpacer}>{icon}</View>}
                    <Txt variant="bodyBold" color={tokens.colors.text.inverse}>{title}</Txt>
                </LinearGradient>
            </TouchableOpacity>
        );
    }

    // Glass: Secondary Action
    return (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={onPress}
            disabled={disabled}
            style={[styles.btnContainer, fullWidth && { width: '100%' }, style]}
        >
            <Surface
                intensity={20}
                style={[styles.btnInner, { borderRadius: radius, height, flexDirection: 'row' }]}
            >
                {icon && <View style={styles.iconSpacer}>{icon}</View>}
                <Txt variant="bodyBold" color={tokens.colors.text.primary}>{title}</Txt>
            </Surface>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    overflowHidden: {
        overflow: 'hidden',
    },
    surfaceBase: {
        backgroundColor: 'transparent',
    },
    btnContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnInner: {
        flex: 1,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconSpacer: {
        marginRight: 8,
    }
});
