import React, { useState } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    ActivityIndicator, useWindowDimensions
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase, OutboxService } from '@gtaxi/core';
import { ghostBorder } from '@gtaxi/design-system/utils/style-rules';

const OUTBOX = OutboxService.getInstance();

interface Props {
    visible: boolean;
    onClose: () => void;
    rideId?: string;
    onSuccess: (profile: any) => void;
}

export function NfcIdentityHandler({ visible, onClose, rideId, onSuccess }: Props) {
    const { width } = useWindowDimensions();
    const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
    const [msg, setMsg] = useState('Hold keychain near back of phone');

    const scanNfcTag = async () => {
        setStatus('scanning');
        setMsg('Reading Universal Key...');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            const mod = require('react-native-nfc-manager');
            const NfcManager = mod.default || mod;
            NfcManager.start();
            await NfcManager.requestTechnology(NfcManager.Tech.NfcA);
            const tag = await NfcManager.getTag();

            if (!tag?.id) {
                throw new Error('Could not read tag. Hold the keychain closer.');
            }

            const tagUid = tag.id;
            const { data: { session } } = await supabase.auth.getSession();

            if (session) {
                await OUTBOX.enqueueProofEvent({
                    eventType: 'TAP_EVENT',
                    tagUid,
                    userId: session.user.id,
                    rideId,
                    nonce: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                    timestamp: new Date().toISOString(),
                });
            }

            const { data: tagRecord, error } = await supabase
                .from('identity_tags')
                .select('*, profiles(*)')
                .eq('tag_uid', tagUid)
                .single();

            NfcManager.cancelTechnologyRequest();

            if (error || !tagRecord) throw new Error('Universal Key not recognized.');

            setStatus('success');
            setMsg('Identity Verified: ' + tagRecord.profiles.full_name);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            setTimeout(() => {
                onSuccess(tagRecord.profiles);
                onClose();
                setStatus('idle');
            }, 1500);

        } catch (err: any) {
            setStatus('error');
            setMsg(err.message);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade">
            <View style={s.overlay}>
                <BlurView intensity={40} style={StyleSheet.absoluteFillObject} tint="dark" />
                <View style={[s.modal, { width: width * 0.85 }]}>
                    <LinearGradient
                        colors={['#161632', '#0A0A1F']}
                        style={StyleSheet.absoluteFillObject}
                    />

                    <View style={s.iconWrap}>
                        {status === 'idle' && <Ionicons name="radio-outline" size={48} color="#34E6EC" />}
                        {status === 'scanning' && <ActivityIndicator color="#34E6EC" size="large" />}
                        {status === 'success' && <Ionicons name="checkmark-circle" size={48} color="#4ADE80" />}
                        {status === 'error' && <Ionicons name="alert-circle" size={48} color="#EF4444" />}
                    </View>

                    <Text style={s.title}>
                        {status === 'idle' ? 'Universal Key' : status.charAt(0).toUpperCase() + status.slice(1)}
                    </Text>
                    <Text style={s.sub}>{msg}</Text>

                    {status === 'idle' && (
                        <TouchableOpacity style={s.btn} onPress={scanNfcTag}>
                            <Text style={s.btnText}>TAP KEYCHAIN</Text>
                        </TouchableOpacity>
                    )}

                    {status === 'error' && (
                        <TouchableOpacity style={s.btn} onPress={() => setStatus('idle')}>
                            <Text style={s.btnText}>TRY AGAIN</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity style={s.close} onPress={onClose}>
                        <Text style={s.closeText}>CANCEL</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    modal: {
        borderRadius: 32, overflow: 'hidden',
        padding: 32, alignItems: 'center',
        ...ghostBorder(0.1),
    },
    iconWrap: {
        width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    title: { fontSize: 20, fontWeight: '900', color: '#EAF3F6', letterSpacing: 1 },
    sub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 8, marginBottom: 32 },
    btn: {
        width: '100%', height: 60, borderRadius: 16, backgroundColor: '#7C3AED',
        alignItems: 'center', justifyContent: 'center',
    },
    btnText: { fontSize: 16, fontWeight: '800', color: '#EAF3F6' },
    close: { marginTop: 20 },
    closeText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },
});
