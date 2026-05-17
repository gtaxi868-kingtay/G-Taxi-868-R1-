import React, { useState } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    ActivityIndicator, Dimensions
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@gtaxi/native';

const { width } = Dimensions.get('window');

interface Props {
    visible: boolean;
    onClose: () => void;
    rideId?: string;
    onSuccess: (profile: any) => void;
}

export function NfcIdentityHandler({ visible, onClose, rideId, onSuccess }: Props) {
    const [status, setStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
    const [msg, setMsg] = useState('Hold keychain near back of phone');

    const simulateNfcScan = async () => {
        setStatus('scanning');
        setMsg('Reading Universal Key...');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        try {
            // In a real build, we'd use react-native-nfc-manager here.
            // Simulating a successful scan of a tag UID: "GTAXI_868_9912"
            const mockTagUid = "GTAXI_868_9912";
            
            const { data: tag, error } = await supabase
                .from('identity_tags')
                .select('*, profiles(*)')
                .eq('tag_uid', mockTagUid)
                .single();

            if (error || !tag) throw new Error("Universal Key not recognized.");

            setStatus('success');
            setMsg('Identity Verified: ' + tag.profiles.full_name);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            setTimeout(() => {
                onSuccess(tag.profiles);
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
                <View style={s.modal}>
                    <LinearGradient
                        colors={['#161632', '#0A0A1F']}
                        style={StyleSheet.absoluteFillObject}
                    />
                    
                    <View style={s.iconWrap}>
                        {status === 'idle' && <Ionicons name="radio-outline" size={48} color="#00FFFF" />}
                        {status === 'scanning' && <ActivityIndicator color="#00FFFF" size="large" />}
                        {status === 'success' && <Ionicons name="checkmark-circle" size={48} color="#4ADE80" />}
                        {status === 'error' && <Ionicons name="alert-circle" size={48} color="#EF4444" />}
                    </View>

                    <Text style={s.title}>
                        {status === 'idle' ? 'Universal Key' : status.toUpperCase()}
                    </Text>
                    <Text style={s.sub}>{msg}</Text>

                    {status === 'idle' && (
                        <TouchableOpacity style={s.btn} onPress={simulateNfcScan}>
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
        width: width * 0.85, borderRadius: 32, overflow: 'hidden',
        padding: 32, alignItems: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    },
    iconWrap: {
        width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.05)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    title: { fontSize: 20, fontWeight: '900', color: '#FFF', letterSpacing: 1 },
    sub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 8, marginBottom: 32 },
    btn: {
        width: '100%', height: 60, borderRadius: 16, backgroundColor: '#7C3AED',
        alignItems: 'center', justifyContent: 'center',
    },
    btnText: { fontSize: 16, fontWeight: '800', color: '#FFF' },
    close: { marginTop: 20 },
    closeText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },
});
