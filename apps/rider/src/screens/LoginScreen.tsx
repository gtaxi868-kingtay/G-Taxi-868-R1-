import React, { useState, useEffect, useRef } from 'react';
import {
    View,
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
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Card } from '../design-system/primitives';

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
                    duration: 8000, // Slower, deeper breath
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 8000,
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
            {/* Background gradient orbs for depth - Adjusted for Premium Dark Mode */}
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

            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.keyboardView}
                >
                    {/* LOGO SECTION */}
                    <View style={styles.logoSection}>
                        <View style={styles.logoGlow} />
                        <Image
                            source={require('../../assets/logo.png')}
                            style={styles.logo}
                            resizeMode="contain"
                        />
                        <Txt variant="displayXL" weight="bold" style={{ letterSpacing: 4 }}>G-TAXI</Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ letterSpacing: 2 }}>RIDE THE FUTURE</Txt>
                    </View>

                    {/* GLASS FORM CARD */}
                    <Card style={styles.glassCard} padding="xl" elevation="level2" radius="xl">

                        {/* Email Input */}
                        <View style={styles.inputGroup}>
                            <Txt variant="small" weight="bold" color={tokens.colors.text.tertiary} style={{ marginBottom: 8, marginLeft: 4 }}>EMAIL</Txt>
                            <Surface
                                style={[
                                    styles.glassInput,
                                    focused === 'email' && styles.glassInputFocused
                                ]}
                                intensity={10}
                            >
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your email"
                                    placeholderTextColor={tokens.colors.text.tertiary}
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => setFocused('email')}
                                    onBlur={() => setFocused(null)}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </Surface>
                        </View>

                        {/* Password Input */}
                        <View style={styles.inputGroup}>
                            <Txt variant="small" weight="bold" color={tokens.colors.text.tertiary} style={{ marginBottom: 8, marginLeft: 4 }}>PASSWORD</Txt>
                            <Surface
                                style={[
                                    styles.glassInput,
                                    focused === 'password' && styles.glassInputFocused
                                ]}
                                intensity={10}
                            >
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your password"
                                    placeholderTextColor={tokens.colors.text.tertiary}
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => setFocused('password')}
                                    onBlur={() => setFocused(null)}
                                    secureTextEntry
                                />
                            </Surface>
                        </View>

                        {/* Error Message */}
                        {error && (
                            <Surface style={styles.errorGlass} intensity={20}>
                                <Txt color={tokens.colors.status.error} center>⚠️ {error}</Txt>
                            </Surface>
                        )}

                        {/* Sign In Button - EXPLICIT IMPLEMENTATION */}
                        <TouchableOpacity
                            onPress={handleLogin}
                            disabled={loading}
                            activeOpacity={0.8}
                            style={[
                                styles.primaryButton,
                                loading && styles.buttonDisabled
                            ]}
                        >
                            <View style={styles.gradientContainer}>
                                {loading ? (
                                    <ActivityIndicator color={tokens.colors.text.inverse} />
                                ) : (
                                    <Txt variant="bodyBold" color={tokens.colors.text.inverse}>Sign In</Txt>
                                )}
                            </View>
                        </TouchableOpacity>
                    </Card>

                    {/* Sign Up Link */}
                    <TouchableOpacity
                        style={styles.signupLink}
                        onPress={() => navigation.navigate('Signup')}
                    >
                        <Txt color={tokens.colors.text.secondary}>
                            Don't have an account?{' '}
                            <Txt color={tokens.colors.primary.purple} weight="bold">Create one</Txt>
                        </Txt>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    safeArea: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: tokens.layout.spacing.lg,
    },
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTopRight: {
        width: 400,
        height: 400,
        backgroundColor: tokens.colors.primary.purple,
        top: -150,
        right: -150,
        opacity: 0.15,
    },
    orbBottomLeft: {
        width: 300,
        height: 300,
        backgroundColor: tokens.colors.primary.cyan,
        bottom: -100,
        left: -100,
        opacity: 0.1,
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: tokens.layout.spacing.xxl,
    },
    logoGlow: {
        position: 'absolute',
        width: 200,
        height: 200,
        borderRadius: 100,
        backgroundColor: tokens.colors.primary.purple,
        opacity: 0.15,
        top: 20,
    },
    logo: {
        width: 240,
        height: 240,
        marginBottom: tokens.layout.spacing.md,
    },
    glassCard: {
        width: '100%',
    },
    inputGroup: {
        marginBottom: tokens.layout.spacing.lg,
    },
    glassInput: {
        borderRadius: tokens.layout.radius.m,
        borderWidth: 1,
        borderColor: tokens.colors.glass.stroke,
    },
    glassInputFocused: {
        borderColor: tokens.colors.primary.purple,
        backgroundColor: 'rgba(159, 85, 255, 0.1)',
    },
    input: {
        paddingHorizontal: tokens.layout.spacing.md,
        paddingVertical: 16,
        fontSize: tokens.typography.sizes.bodyReg,
        color: tokens.colors.text.primary,
        fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },
    errorGlass: {
        backgroundColor: 'rgba(255, 69, 58, 0.1)',
        borderRadius: tokens.layout.radius.s,
        padding: tokens.layout.spacing.md,
        marginBottom: tokens.layout.spacing.lg,
        borderWidth: 1,
        borderColor: 'rgba(255, 69, 58, 0.3)',
    },
    signupLink: {
        marginTop: tokens.layout.spacing.xl,
        alignItems: 'center',
    },
    primaryButton: {
        marginTop: tokens.layout.spacing.sm,
        borderRadius: tokens.layout.radius.full,
        overflow: 'hidden',
        backgroundColor: tokens.colors.primary.cyan, // Fallback if no container bg
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    gradientContainer: {
        backgroundColor: tokens.colors.primary.purple, // Simple solid for now to guarantee visibility
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
});
