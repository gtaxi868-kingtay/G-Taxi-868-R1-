import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, TouchableOpacityProps, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../theme';

interface GlassButtonProps extends TouchableOpacityProps {
    title?: string;
    variant?: 'primary' | 'secondary' | 'glass';
    loading?: boolean;
    icon?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}

export const GlassButton = ({
    title,
    variant = 'primary',
    loading = false,
    icon,
    style,
    textStyle,
    children,
    disabled,
    ...props
}: GlassButtonProps) => {

    const getButtonStyle = () => {
        switch (variant) {
            case 'primary': return styles.primary;
            case 'secondary': return styles.secondary;
            case 'glass': return styles.glass;
            default: return styles.primary;
        }
    };

    const getTextStyle = () => {
        switch (variant) {
            case 'glass': return styles.glassText;
            default: return styles.primaryText;
        }
    };

    return (
        <TouchableOpacity
            style={[
                styles.base,
                getButtonStyle(),
                disabled && styles.disabled,
                style
            ]}
            disabled={disabled || loading}
            activeOpacity={0.8}
            {...props}
        >
            {loading ? (
                <ActivityIndicator color={variant === 'glass' ? theme.colors.text.primary : theme.colors.text.inverse} />
            ) : (
                <>
                    {icon && <Text style={styles.icon}>{icon}</Text>}
                    {title && <Text style={[getTextStyle(), textStyle]}>{title}</Text>}
                    {children}
                </>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.borderRadius.lg,
        paddingVertical: 16,
        paddingHorizontal: theme.spacing.xl,
    },
    primary: {
        backgroundColor: theme.colors.brand.primary,
        ...theme.shadows.glow,
    },
    secondary: {
        backgroundColor: theme.colors.background.tertiary,
        borderWidth: 1,
        borderColor: theme.colors.brand.primary,
    },
    glass: {
        backgroundColor: theme.colors.glass.backgroundLight,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    disabled: {
        opacity: 0.6,
    },
    primaryText: {
        color: theme.colors.text.inverse,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.bold,
        letterSpacing: 1,
    },
    glassText: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.semibold,
    },
    icon: {
        marginRight: theme.spacing.sm,
    },
});
