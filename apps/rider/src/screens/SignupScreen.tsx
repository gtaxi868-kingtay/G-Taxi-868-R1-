import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    KeyboardAvoidingView,
    Platform,
    Image,
    Animated,
    Dimensions,
    ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface, Btn, Card } from '../design-system/primitives';

const { width, height } = Dimensions.get('window');

interface SignupScreenProps {
    navigation: any;
}

export function SignupScreen({ navigation }: SignupScreenProps) {
    const [fullName, setFullName] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
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
                    duration: 8000,
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

    const handleSignup = async () => {
        if (!fullName || !phoneNumber || !email || !password || !confirmPassword) {
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
                                <Txt style={{ fontSize: 22 }}>←</Txt>
                            </TouchableOpacity>
                            <View style={{ width: 44 }} />
                        </View>

                        {/* Centered Large Logo Section */}
                        <View style={styles.logoSection}>
                            <View style={styles.logoGlow} />
                            <Image
                                source={require('../../assets/logo.png')}
                                style={styles.logo}
                                resizeMode="contain"
                            />
                        </View>

                        <Txt variant="headingL" weight="bold" style={{ marginBottom: 4 }}>Create Account</Txt>
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={{ marginBottom: 32 }}>Join G-Taxi and start riding</Txt>

                        {/* Glass Form Card */}
                        <Card style={styles.glassCard} padding="xl" elevation="level2" radius="xl">

                            {/* Full Name */}
                            <View style={styles.inputGroup}>
                                <Txt variant="small" weight="bold" color={tokens.colors.text.tertiary} style={{ marginBottom: 8, marginLeft: 4 }}>FULL NAME</Txt>
                                <Surface
                                    style={[
                                        styles.glassInput,
                                        focused === 'name' && styles.glassInputFocused
                                    ]}
                                    intensity={10}
                                >
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter your full name"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={fullName}
                                        onChangeText={setFullName}
                                        onFocus={() => setFocused('name')}
                                        onBlur={() => setFocused(null)}
                                    />
                                </Surface>
                            </View>

                            {/* Phone Number */}
                            <View style={styles.inputGroup}>
                                <Txt variant="small" weight="bold" color={tokens.colors.text.tertiary} style={{ marginBottom: 8, marginLeft: 4 }}>PHONE NUMBER</Txt>
                                <Surface
                                    style={[
                                        styles.glassInput,
                                        focused === 'phone' && styles.glassInputFocused
                                    ]}
                                    intensity={10}
                                >
                                    <TextInput
                                        style={styles.input}
                                        placeholder="+1 (868) 000-0000"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={phoneNumber}
                                        onChangeText={setPhoneNumber}
                                        onFocus={() => setFocused('phone')}
                                        onBlur={() => setFocused(null)}
                                        keyboardType="phone-pad"
                                    />
                                </Surface>
                            </View>

                            {/* Email */}
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

                            {/* Password */}
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
                                        placeholder="Create a password"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={password}
                                        onChangeText={setPassword}
                                        onFocus={() => setFocused('password')}
                                        onBlur={() => setFocused(null)}
                                        secureTextEntry
                                    />
                                </Surface>
                            </View>

                            {/* Confirm Password */}
                            <View style={styles.inputGroup}>
                                <Txt variant="small" weight="bold" color={tokens.colors.text.tertiary} style={{ marginBottom: 8, marginLeft: 4 }}>CONFIRM PASSWORD</Txt>
                                <Surface
                                    style={[
                                        styles.glassInput,
                                        focused === 'confirm' && styles.glassInputFocused
                                    ]}
                                    intensity={10}
                                >
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Confirm your password"
                                        placeholderTextColor={tokens.colors.text.tertiary}
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        onFocus={() => setFocused('confirm')}
                                        onBlur={() => setFocused(null)}
                                        secureTextEntry
                                    />
                                </Surface>
                            </View>

                            {error && (
                                <Surface style={styles.errorGlass} intensity={20}>
                                    <Txt color={tokens.colors.status.error} center>⚠️ {error}</Txt>
                                </Surface>
                            )}

                            <Btn
                                title={loading ? "Creating Account..." : "Create Account"}
                                onPress={handleSignup}
                                disabled={loading}
                                fullWidth
                                variant="primary"
                                style={{ marginTop: 12 }}
                            />
                        </Card>

                        <TouchableOpacity
                            style={styles.loginLink}
                            onPress={() => navigation.navigate('Login')}
                        >
                            <Txt color={tokens.colors.text.secondary}>
                                Already have an account?{' '}
                                <Txt color={tokens.colors.primary.purple} weight="bold">Sign in</Txt>
                            </Txt>
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
        backgroundColor: tokens.colors.background.base,
    },
    safeArea: {
        flex: 1,
    },
    keyboardView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: tokens.layout.spacing.lg,
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
        backgroundColor: tokens.colors.primary.purple,
        top: -100,
        right: -120,
        opacity: 0.15,
    },
    orbBottomLeft: {
        width: 300,
        height: 300,
        backgroundColor: tokens.colors.primary.cyan,
        bottom: -50,
        left: -100,
        opacity: 0.1,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: tokens.layout.spacing.lg,
        marginBottom: tokens.layout.spacing.xl,
    },
    glassButton: {
        width: 44,
        height: 44,
        borderRadius: tokens.layout.radius.m,
        backgroundColor: tokens.colors.glass.fill,
        borderWidth: 1,
        borderColor: tokens.colors.glass.stroke,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: tokens.layout.spacing.lg,
    },
    logoGlow: {
        position: 'absolute',
        width: 160,
        height: 160,
        borderRadius: 80,
        backgroundColor: tokens.colors.primary.purple,
        opacity: 0.15,
        top: 40,
    },
    logo: {
        width: 240,
        height: 240,
    },

    // Glass Card
    glassCard: {
        width: '100%',
    },

    // Input styles
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
        paddingVertical: 14,
        fontSize: tokens.typography.sizes.bodyReg,
        color: tokens.colors.text.primary,
        fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    },

    // Error
    errorGlass: {
        backgroundColor: 'rgba(255, 69, 58, 0.1)',
        borderRadius: tokens.layout.radius.s,
        padding: tokens.layout.spacing.md,
        marginBottom: tokens.layout.spacing.lg,
        borderWidth: 1,
        borderColor: 'rgba(255, 69, 58, 0.3)',
    },

    // Login link
    loginLink: {
        marginTop: tokens.layout.spacing.xl,
        alignItems: 'center',
    },
});
