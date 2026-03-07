import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SafeAreaView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '../../../../shared/supabase';
import { useAuth } from '../context/AuthContext';
import { tokens } from '../design-system/tokens';
import { Txt, Surface } from '../design-system/primitives';
import { Ionicons } from '@expo/vector-icons';
import { ENV } from '../../../../shared/env';

export function WalletTopUpScreen({ navigation }: any) {
    const { user } = useAuth();
    const [balance, setBalance] = useState<number | null>(null);
    const [selectedAmount, setSelectedAmount] = useState<number>(100);
    const [customAmount, setCustomAmount] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    const { initPaymentSheet, presentPaymentSheet } = useStripe();

    useEffect(() => {
        if (user?.id) {
            supabase.rpc('get_wallet_balance', { p_user_id: user.id })
                .then(({ data, error }) => {
                    if (!error && data !== null) {
                        setBalance(data / 100);
                    } else {
                        setBalance(0);
                    }
                });
        }
    }, [user?.id]);

    const handleAmountSelect = (amount: number) => {
        setCustomAmount('');
        setSelectedAmount(amount);
    };

    const handleCustomAmountChange = (text: string) => {
        setCustomAmount(text);
        setSelectedAmount(0);
    };

    const handleAddFunds = async () => {
        const finalAmount = customAmount ? parseFloat(customAmount) : selectedAmount;

        if (isNaN(finalAmount) || finalAmount < 20) {
            Alert.alert('Invalid Amount', 'Minimum top-up amount is $20 TTD.');
            return;
        }

        if (finalAmount > 1000) {
            Alert.alert('Invalid Amount', 'Maximum top-up amount is $1000 TTD.');
            return;
        }

        setIsLoading(true);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            if (!token) throw new Error('No valid session found. Please log in again.');

            const functionsUrl = `${ENV.SUPABASE_URL || 'https://vtdihpaxmwwkymwttjro.supabase.co'}/functions/v1/create_wallet_topup`;

            const response = await fetch(functionsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ amount_ttd: finalAmount })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create payment intent');
            }

            const { clientSecret } = await response.json();

            if (!clientSecret) {
                throw new Error('No client secret returned');
            }

            const { error: initError } = await initPaymentSheet({
                paymentIntentClientSecret: clientSecret,
                merchantDisplayName: 'G-Taxi',
                style: 'alwaysDark',
                appearance: {
                    colors: {
                        primary: tokens.colors.primary.purple,
                        background: '#0a0118',
                        componentBackground: '#1a0a28',
                        componentText: '#FFFFFF',
                        primaryText: '#FFFFFF',
                        secondaryText: '#A0A0B0',
                        placeholderText: '#606070',
                        icon: '#FFFFFF',
                        error: '#FF4D4D',
                    },
                },
            });

            if (initError) {
                throw new Error(initError.message);
            }

            const { error: presentError } = await presentPaymentSheet();

            if (presentError) {
                if (presentError.code !== 'Canceled') {
                    throw new Error(presentError.message);
                }
            } else {
                Alert.alert('Success', `$${finalAmount} TTD added to your wallet!`);
                navigation.goBack();
            }

        } catch (error: any) {
            Alert.alert('Payment Failed', error.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    const amounts = [50, 100, 200, 500];
    const displayAmount = customAmount ? parseFloat(customAmount) || 0 : selectedAmount;

    return (
        <SafeAreaView style={styles.container}>
            {/* HEADER ROW */}
            <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={tokens.colors.primary.purple} />
                </TouchableOpacity>
                <Txt variant="headingM" weight="bold" style={styles.headerTitle}>Add Funds</Txt>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                {/* BALANCE DISPLAY */}
                <Surface intensity={30} style={styles.balanceCard}>
                    <Txt variant="caption" color={tokens.colors.text.secondary}>Current Balance</Txt>
                    <Txt variant="headingL" weight="bold" color={tokens.colors.status.success}>
                        ${balance !== null ? balance.toFixed(2) : '...'} TTD
                    </Txt>
                </Surface>

                {/* AMOUNT SELECTION */}
                <View style={styles.section}>
                    <Txt variant="bodyBold" style={styles.sectionLabel}>Select Amount</Txt>
                    <View style={styles.grid}>
                        {amounts.map(amt => {
                            const isSelected = selectedAmount === amt && customAmount === '';
                            return (
                                <TouchableOpacity
                                    key={amt}
                                    onPress={() => handleAmountSelect(amt)}
                                    style={styles.gridBtnWrapper}
                                >
                                    <Surface
                                        intensity={isSelected ? 60 : 20}
                                        style={[
                                            styles.amountBtn,
                                            isSelected && styles.amountBtnSelected
                                        ]}
                                    >
                                        <Txt variant="headingM" weight="bold" color={isSelected ? tokens.colors.primary.purple : tokens.colors.text.primary}>
                                            ${amt}
                                        </Txt>
                                        <Txt variant="caption" color={tokens.colors.text.secondary}>TTD</Txt>
                                    </Surface>
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                    <TextInput
                        style={styles.customAmountInput}
                        placeholder="Or enter custom amount"
                        placeholderTextColor={tokens.colors.text.tertiary}
                        keyboardType="numeric"
                        value={customAmount}
                        onChangeText={handleCustomAmountChange}
                    />
                </View>

                {/* CARD PAYMENT SECTION */}
                <View style={styles.section}>
                    <Txt variant="bodyBold" style={styles.sectionLabel}>Pay with Card</Txt>
                    <Surface intensity={20} style={styles.infoCard}>
                        <Ionicons name="card-outline" size={20} color={tokens.colors.text.secondary} style={styles.infoIcon} />
                        <Txt variant="bodyReg" color={tokens.colors.text.secondary} style={styles.infoText}>
                            Powered by Stripe. Your card information is secure.
                        </Txt>
                    </Surface>
                </View>
            </View>

            {/* ADD FUNDS BUTTON */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.payBtn, isLoading && styles.payBtnDisabled]}
                    onPress={handleAddFunds}
                    disabled={isLoading || displayAmount === 0}
                >
                    {isLoading ? (
                        <ActivityIndicator color={tokens.colors.background.base} />
                    ) : (
                        <Txt variant="bodyBold" color={tokens.colors.background.base}>
                            {displayAmount > 0 ? `Add $${displayAmount} TTD` : 'Enter Amount'}
                        </Txt>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    backBtn: {
        width: 40,
        alignItems: 'flex-start',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    balanceCard: {
        padding: 24,
        alignItems: 'center',
        borderRadius: 16,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    section: {
        marginBottom: 32,
    },
    sectionLabel: {
        marginBottom: 16,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -6,
        marginBottom: 16,
    },
    gridBtnWrapper: {
        width: '50%',
        padding: 6,
    },
    amountBtn: {
        paddingVertical: 20,
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    amountBtnSelected: {
        borderColor: tokens.colors.primary.purple,
        backgroundColor: 'rgba(0,200,150,0.1)',
    },
    customAmountInput: {
        backgroundColor: tokens.colors.background.ambient,
        color: tokens.colors.text.primary,
        fontFamily: ['Inter-SemiBold', 'System'].join(','),
        fontSize: 16,
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    infoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    infoIcon: {
        marginRight: 12,
    },
    infoText: {
        flex: 1,
    },
    footer: {
        paddingHorizontal: 20,
        paddingBottom: 24,
        paddingTop: 16,
    },
    payBtn: {
        backgroundColor: tokens.colors.status.success,
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    payBtnDisabled: {
        opacity: 0.6,
    },
});
