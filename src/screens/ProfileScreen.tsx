import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    ScrollView,
    Alert,
    Image,
    Animated,
    Dimensions,
    Platform,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { theme } from '../theme';

const { width } = Dimensions.get('window');

interface ProfileScreenProps {
    navigation: any;
}

export function ProfileScreen({ navigation }: ProfileScreenProps) {
    const { user, signOut } = useAuth();

    // Animation refs
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

    const handleLogout = async () => {
        Alert.alert(
            'Logout',
            'Are you sure you want to logout?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Logout',
                    style: 'destructive',
                    onPress: async () => {
                        await signOut();
                    }
                },
            ]
        );
    };

    const menuItems = [
        { icon: '🚗', label: 'Your Trips', onPress: () => Alert.alert('Coming Soon', 'Ride history will be available soon.') },
        { icon: '💳', label: 'Payment', onPress: () => Alert.alert('Coming Soon', 'Payment methods will be available soon.') },
        { icon: '📍', label: 'Saved Places', onPress: () => Alert.alert('Coming Soon', 'Saved places will be available soon.') },
        { icon: '⚙️', label: 'Settings', onPress: () => Alert.alert('Coming Soon', 'Settings will be available soon.') },
        { icon: '❓', label: 'Help', onPress: () => Alert.alert('Coming Soon', 'Help & Support will be available soon.') },
    ];

    const floatTranslate = floatAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 15],
    });

    return (
        <View style={styles.container}>
            {/* Background Orbs */}
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbTop,
                    { transform: [{ translateY: floatTranslate }] }
                ]}
            />
            <Animated.View
                style={[
                    styles.backgroundOrb,
                    styles.orbBottom,
                    { transform: [{ translateY: Animated.multiply(floatTranslate, -1) }] }
                ]}
            />

            <SafeAreaView style={styles.safeArea}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.glassButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.backText}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Account</Text>
                    <View style={styles.logoContainer}>
                        <Image
                            source={require('../../assets/logo.png')}
                            style={styles.logo}
                            resizeMode="contain"
                        />
                    </View>
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                    {/* Glass Profile Card */}
                    <TouchableOpacity style={styles.glassProfileCard} activeOpacity={0.7}>
                        <View style={styles.glassHighlight} />

                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                                {user?.email?.charAt(0).toUpperCase() || 'U'}
                            </Text>
                        </View>
                        <View style={styles.profileInfo}>
                            <Text style={styles.profileName}>
                                {user?.email?.split('@')[0] || 'Rider'}
                            </Text>
                            <Text style={styles.profileEmail}>{user?.email}</Text>
                        </View>
                        <View style={styles.chevronContainer}>
                            <Text style={styles.chevron}>›</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Glass Menu Section */}
                    <View style={styles.glassMenuSection}>
                        {menuItems.map((item, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[
                                    styles.menuItem,
                                    index === menuItems.length - 1 && styles.menuItemLast
                                ]}
                                onPress={item.onPress}
                                activeOpacity={0.7}
                            >
                                <View style={styles.menuIconContainer}>
                                    <Text style={styles.menuIcon}>{item.icon}</Text>
                                </View>
                                <Text style={styles.menuLabel}>{item.label}</Text>
                                <Text style={styles.menuChevron}>›</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Glass Logout Button */}
                    <TouchableOpacity
                        style={styles.glassLogoutButton}
                        onPress={handleLogout}
                        activeOpacity={0.7}
                    >
                        <View style={styles.logoutIconContainer}>
                            <Text style={styles.logoutIcon}>🚪</Text>
                        </View>
                        <Text style={styles.logoutText}>Logout</Text>
                    </TouchableOpacity>

                    {/* Version */}
                    <View style={styles.versionContainer}>
                        <Text style={styles.version}>G-Taxi Rider v1.0.0</Text>
                        <Text style={styles.copyright}>© 2026 G-Taxi</Text>
                    </View>
                </ScrollView>
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

    // Background Orbs
    backgroundOrb: {
        position: 'absolute',
        borderRadius: 999,
    },
    orbTop: {
        width: 350,
        height: 350,
        backgroundColor: theme.colors.brand.glowSubtle,
        top: -100,
        right: -100,
        opacity: 0.6,
    },
    orbBottom: {
        width: 300,
        height: 300,
        backgroundColor: theme.colors.accent.purple,
        bottom: 50,
        left: -80,
        opacity: 0.15,
    },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
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
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
        } : {}),
    },
    backText: {
        color: theme.colors.text.primary,
        fontSize: 22,
    },
    headerTitle: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.xl,
        fontWeight: theme.typography.weights.bold,
        letterSpacing: 1,
    },
    logoContainer: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logo: {
        width: 40,
        height: 40,
    },
    content: {
        flex: 1,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
    },

    // Profile Card
    glassProfileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.xxl,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
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
    avatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: theme.colors.brand.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...theme.shadows.glow,
    },
    avatarText: {
        color: theme.colors.text.inverse,
        fontSize: theme.typography.sizes.xxl,
        fontWeight: theme.typography.weights.bold,
    },
    profileInfo: {
        flex: 1,
        marginLeft: theme.spacing.lg,
    },
    profileName: {
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.lg,
        fontWeight: theme.typography.weights.semibold,
        marginBottom: 2,
    },
    profileEmail: {
        color: theme.colors.text.secondary,
        fontSize: theme.typography.sizes.sm,
    },
    chevronContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    chevron: {
        color: theme.colors.text.secondary,
        fontSize: 20,
    },

    // Menu Section
    glassMenuSection: {
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xl,
        marginBottom: theme.spacing.xxl,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
        } : {}),
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.glass.border,
    },
    menuItemLast: {
        borderBottomWidth: 0,
    },
    menuIconContainer: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.glass.backgroundLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.glass.border,
    },
    menuIcon: {
        fontSize: 20,
    },
    menuLabel: {
        flex: 1,
        color: theme.colors.text.primary,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.medium,
    },
    menuChevron: {
        color: theme.colors.text.tertiary,
        fontSize: 24,
    },

    // Logout Button
    glassLogoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.glass.background,
        borderRadius: theme.borderRadius.xl,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.xxl,
        borderWidth: 1,
        borderColor: 'rgba(255, 77, 77, 0.3)',
        ...(Platform.OS === 'web' ? {
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
        } : {}),
    },
    logoutIconContainer: {
        width: 40,
        height: 40,
        borderRadius: theme.borderRadius.md,
        backgroundColor: 'rgba(255, 77, 77, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: theme.spacing.md,
    },
    logoutIcon: {
        fontSize: 20,
    },
    logoutText: {
        color: theme.colors.status.error,
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.semibold,
    },

    versionContainer: {
        alignItems: 'center',
        paddingBottom: theme.spacing.xxxl,
    },
    version: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.sm,
        marginBottom: theme.spacing.xs,
    },
    copyright: {
        color: theme.colors.text.tertiary,
        fontSize: theme.typography.sizes.xs,
    },
});
