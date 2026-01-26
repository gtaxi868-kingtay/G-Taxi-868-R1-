import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Image,
    Animated,
    Dimensions,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');

interface LoginScreenProps {
    navigation: any;
}

export function LoginScreen({ navigation }: LoginScreenProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [focused, setFocused] = useState<'email' | 'password' | null>(null);
    const { signIn } = useAuth();

    // Subtle floating animation for background orbs
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: 1,
                    duration: 4000,
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 4000,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    const handleLogin = async () => {
        if (!email || !password) {
            setError('Please fill in all fields');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { error: signInError } = await signIn(email, password);
            if (signInError) {
                setError(signInError.message);
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 20],
    });

    return (
        <View style={styles.container}>
            {/* Background gradient orbs for depth */}
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbTopRight,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbBottomLeft,
                    { transform: [{ translateY: Animated.multiply(floatTranslate, -1) }] }
                ]}
            />
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbCenter,
                ]}
            />

            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.keyboardView}
                >
                    {/* GIANT LOGO - 3x larger */}
                    <View style={styles.logoSection}>
                        <View style={styles.logoGlow} />
                        <Image
                            source={require('../../assets/logo.png')}
                            style={styles.logo}
                            resizeMode="contain"
                        />
                        <Text style={styles.appName}>G-TAXI</Text>
                        <Text style={styles.tagline}>Ride the Future</Text>
                    </View>

                    {/* GLASS FORM CARD */}
                    <View style={styles.glassCard}>
                        {/* Top highlight edge (glass effect) */}
                        <View style={styles.glassHighlight} />

                        {/* Email Input */}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Email</Text>
                            <View style={[
                                styles.glassInput,
                                focused === 'email' && styles.glassInputFocused
                            ]}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your email"
                                    placeholderTextColor={theme.colors.text.tertiary}
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => setFocused('email')}
                                    onBlur={() => setFocused(null)}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>
                        </View>

                        {/* Password Input */}
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Password</Text>
                            <View style={[
                                styles.glassInput,
                                focused === 'password' && styles.glassInputFocused
                            ]}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your password"
                                    placeholderTextColor={theme.colors.text.tertiary}
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => setFocused('password')}
                                    onBlur={() => setFocused(null)}
                                    secureTextEntry
                                />
                            </View>
                        </View>

                        {/* Error Message */}
                        {error && (
                            <View style={styles.errorGlass}>
                                <Text style={styles.errorText}>⚠️ {error}</Text>
                            </View>
                        )}

                        {/* Sign In Button */}
                        <TouchableOpacity
                            style={[styles.primaryButton, loading && styles.buttonDisabled]}
                            onPress={handleLogin}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color={theme.colors.text.inverse} />
                            ) : (
                                <Text style={styles.primaryButtonText}>Sign In</Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Sign Up Link */}
                    <TouchableOpacity
                        style={styles.signupLink}
                        onPress={() => navigation.navigate('Signup')}
                    >
                        <Text style={styles.signupText}>
                            Don't have an account?{' '}
                            <Text style={styles.signupHighlight}>Create one</Text>
                        </Text>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
    },
    safeArea: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.xxl,
    },

    // ================================
    // BACKGROUND ORBS (for depth)
    // ================================
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTopRight: {
        width: 400,
        height: 400,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -150,
        right: -150,
        opacity: 0.8,
    },
    orbBottomLeft: {
        width: 300,
        height: 300,
        backgroundColor: theme.colors.accent.purple,
        bottom: -100,
        left: -100,
        opacity: 0.15,
    },
    orbCenter: {
        width: 500,
        height: 500,
        backgroundColor: theme.colors.brand.glow,
        top: height * 0.2,
        left: width * 0.3,
        opacity: 0.05,
    },

    // ================================
    // LOGO SECTION - 3X LARGER
    // ================================
    logoSection: {
        alignItems: 'center',
        marginBottom: theme.spacing.huge,
    },
    logoGlow: {
        position: 'absolute',
        width: 280,
        height: 280,
        borderRadius: 140,
        backgroundColor: theme.colors.brand.glow,
        opacity: 0.3,
    },
    logo: {
        width: 240,  // 3X LARGER (was 80)
        height: 240, // 3X LARGER (was 80)
        marginBottom: theme.spacing.xl,
    },
    appName: {
        fontSize: theme.typography.sizes.hero,
        fontWeight: theme.typography.weights.black,
        color: theme.colors.text.primary,
        letterSpacing: 6,
    },
    tagline: {
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.light,
        color: theme.colors.text.secondary,
        marginTop: theme.spacing.xs,
        letterSpacing: 2,
    },

    // ================================
    // iOS 26 GLASS CARD
    // ================================
    glassCard: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xxl,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        padding: theme.spacing.xxl,
        overflow: 'hidden',
        // Web-only glassmorphism
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
        } : {}),
    },
    glassHighlight: {
        position: 'absolute',
        top: 0,
        left: 20,
        right: 20,
        height: 1,
        backgroundColor: theme.colors.glass.highlight,
    },

    // ================================
    // GLASS INPUT FIELDS
    // ================================
    inputGroup: {
        marginBottom: theme.spacing.lg,
    },
    inputLabel: {
        fontSize: theme.typography.sizes.sm,
        fontWeight: theme.typography.weights.medium,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing.sm,
        marginLeft: theme.spacing.xs,
    },
    glassInput: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
    },
    glassInputFocused: {
        borderColor: theme.colors.glass.borderBrand,
        backgroundColor: theme.colors.glass.backgroundLight,
    },
    input: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: 16,
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.primary,
    },

    // ================================
    // ERROR (Glass style)
    // ================================
    errorGlass: {
        backgroundColor: 'rgba(255, 107, 107, 0.15)',
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: 'rgba(255, 107, 107, 0.3)',
        padding: theme.spacing.md,
        marginBottom: theme.spacing.lg,
    },
    errorText: {
        color: theme.colors.status.error,
        fontSize: theme.typography.sizes.sm,
        textAlign: 'center',
    },

    // ================================
    // PRIMARY BUTTON (Solid teal)
    // ================================
    primaryButton: {
        backgroundColor: theme.colors.brand.primary,
        borderRadius: theme.borderRadius.lg,
        paddingVertical: 18,
        alignItems: 'center',
        marginTop: theme.spacing.sm,
        ...theme.shadows.glow,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    primaryButtonText: {
        color: theme.colors.text.inverse,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.bold,
    },

    // ================================
    // SIGNUP LINK
    // ================================
    signupLink: {
        marginTop: theme.spacing.xxl,
        alignItems: 'center',
    },
    signupText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    signupHighlight: {
        color: theme.colors.brand.primary,
        fontWeight: theme.typography.weights.semibold,
    },
});
