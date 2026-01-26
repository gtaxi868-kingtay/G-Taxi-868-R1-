import React, { useState, useRef, useEffect } from 'react';
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
    ScrollView,
    Image,
    Animated,
    Dimensions,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { theme } from '../theme';

const { width, height } = Dimensions.get('window');

interface SignupScreenProps {
    navigation: any;
}

export function SignupScreen({ navigation }: SignupScreenProps) {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [focused, setFocused] = useState<string | null>(null);
    const { signUp } = useAuth();

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

    const handleSignup = async () => {
        if (!fullName || !email || !password || !confirmPassword) {
            setError('Please fill in all fields');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { error: signUpError } = await signUp(email, password, fullName);
            if (signUpError) {
                setError(signUpError.message);
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
            {/* Background orbs */}
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbTopRight,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />
            <Animated.View style={[styles.backgroundOrb, styles.orbBottomLeft]} />

            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.keyboardView}
                >
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Header */}
                        <View style={styles.header}>
                            <TouchableOpacity
                                style={styles.glassButton}
                                onPress={() => navigation.goBack()}
                            >
                                <Text style={styles.backText}>←</Text>
                            </TouchableOpacity>
                            <Image
                                source={require('../../assets/logo.png')}
                                style={styles.headerLogo}
                                resizeMode="contain"
                            />
                        </View>

                        <Text style={styles.title}>Create Account</Text>
                        <Text style={styles.subtitle}>Join G-Taxi and start riding</Text>

                        {/* Glass Form Card */}
                        <View style={styles.glassCard}>
                            <View style={styles.glassHighlight} />

                            {/* Full Name */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Full Name</Text>
                                <View style={[
                                    styles.glassInput,
                                    focused === 'name' && styles.glassInputFocused
                                ]}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your full name"
                                        placeholderTextColor={theme.colors.text.tertiary}
                                        value={fullName}
                                        onChangeText={setFullName}
                                        onFocus={() => setFocused('name')}
                                        onBlur={() => setFocused(null)}
                                    />
                                </View>
                            </View>

                            {/* Email */}
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

                            {/* Password */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Password</Text>
                                <View style={[
                                    styles.glassInput,
                                    focused === 'password' && styles.glassInputFocused
                                ]}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Create a password"
                                        placeholderTextColor={theme.colors.text.tertiary}
                                        value={password}
                                        onChangeText={setPassword}
                                        onFocus={() => setFocused('password')}
                                        onBlur={() => setFocused(null)}
                                        secureTextEntry
                                    />
                                </View>
                            </View>

                            {/* Confirm Password */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Confirm Password</Text>
                                <View style={[
                                    styles.glassInput,
                                    focused === 'confirm' && styles.glassInputFocused
                                ]}>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Confirm your password"
                                        placeholderTextColor={theme.colors.text.tertiary}
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        onFocus={() => setFocused('confirm')}
                                        onBlur={() => setFocused(null)}
                                        secureTextEntry
                                    />
                                </View>
                            </View>

                            {error && (
                                <View style={styles.errorGlass}>
                                    <Text style={styles.errorText}>⚠️ {error}</Text>
                                </View>
                            )}

                            <TouchableOpacity
                                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                                onPress={handleSignup}
                                disabled={loading}
                                activeOpacity={0.8}
                            >
                                {loading ? (
                                    <ActivityIndicator color={theme.colors.text.inverse} />
                                ) : (
                                    <Text style={styles.primaryButtonText}>Create Account</Text>
                                )}
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={styles.loginLink}
                            onPress={() => navigation.navigate('Login')}
                        >
                            <Text style={styles.loginText}>
                                Already have an account?{' '}
                                <Text style={styles.loginHighlight}>Sign in</Text>
                            </Text>
                        </TouchableOpacity>
                    </ScrollView>
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
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: theme.spacing.xxl,
        paddingBottom: 40,
    },

    // Background orbs
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTopRight: {
        width: 350,
        height: 350,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -100,
        right: -120,
        opacity: 0.7,
    },
    orbBottomLeft: {
        width: 300,
        height: 300,
        backgroundColor: theme.colors.accent.purple,
        bottom: -50,
        left: -100,
        opacity: 0.12,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: theme.spacing.lg,
        marginBottom: theme.spacing.xxl,
    },
    glassButton: {
        width: 44,
        height: 44,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.background,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backText: {
        fontSize: 22,
        color: theme.colors.text.primary,
    },
    headerLogo: {
        width: 44,
        height: 44,
    },

    title: {
        fontSize: theme.typography.sizes.xxxl,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary,
        marginBottom: theme.spacing.xs,
    },
    subtitle: {
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.secondary,
        marginBottom: theme.spacing.xxl,
    },

    // Glass Card
    glassCard: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xxl,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        padding: theme.spacing.xxl,
        overflow: 'hidden',
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

    // Input styles
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
    },
    glassInputFocused: {
        borderColor: theme.colors.glass.borderBrand,
        backgroundColor: theme.colors.glass.backgroundLight,
    },
    input: {
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: 14,
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.primary,
    },

    // Error
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

    // Button
    primaryButton: {
        backgroundColor: theme.colors.brand.primary,
        borderRadius: theme.borderRadius.lg,
        paddingVertical: 16,
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

    // Login link
    loginLink: {
        marginTop: theme.spacing.xxl,
        alignItems: 'center',
    },
    loginText: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.md,
    },
    loginHighlight: {
        color: theme.colors.brand.primary,
        fontWeight: theme.typography.weights.semibold,
    },
});
