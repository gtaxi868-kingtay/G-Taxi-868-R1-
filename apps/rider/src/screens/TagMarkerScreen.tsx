import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SURFACE, VOICES } from '@gtaxi/design-system';
import { ghostBorder, glassSurface } from '@gtaxi/design-system/utils/style-rules';
import { AppScreenProps } from '../navigation/types';

// A rider lands here when NfcScanScreen's routeNfcTag() classifies a scanned
// tag as 'blank' — not yet provisioned as a merchant, taxi stand, or personal
// identity tag. This used to be a full self-service "provision this node"
// form that wrote directly to kiosk_nodes from the rider's own client — but
// no RLS policy has ever granted a plain rider INSERT on that table (only
// admin has ALL, commanders have SELECT/UPDATE on their own territory), so
// every submission from here has always failed. Riders have no business
// provisioning nodes in the first place: that's the commander's job
// (CommanderRegisterNodeScreen, apps/driver) which routes through
// commander_register_node for admin approval, or the admin's own
// TagMarkerScreen (apps/admin-mobile), which goes through the `admin` edge
// function's manage_nodes action. This screen now just tells the rider the
// truth instead of offering a form that can never succeed.
export function TagMarkerScreen({ navigation, route }: AppScreenProps<'TagMarker'>) {
    const tagUid = route?.params?.tagUid || '';

    const handleBack = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        navigation.goBack();
    };

    return (
        <View style={s.container}>
            <TouchableOpacity style={s.backBtn} onPress={handleBack}>
                <Ionicons name="close" size={28} color="#EAF3F6" />
            </TouchableOpacity>

            <View style={s.content}>
                <View style={[glassSurface(40), s.card]}>
                    <View style={s.badgeIcon}>
                        <Ionicons name="pricetag-outline" size={32} color={VOICES.rider.accent} />
                    </View>
                    <Text style={s.headerTitle}>New Tag Detected</Text>
                    {tagUid ? <Text style={s.tagCode}>{tagUid}</Text> : null}
                    <Text style={s.body}>
                        This spot isn't set up in G-Taxi yet. Your community's commander can
                        register it — in the meantime you can still book a ride normally.
                    </Text>

                    <TouchableOpacity style={s.primaryBtn} onPress={handleBack}>
                        <Text style={s.primaryBtnText}>Continue Booking</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: SURFACE.base },
    backBtn: {
        position: 'absolute', top: 56, left: 16, zIndex: 10,
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center',
    },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', borderRadius: 32, padding: 32, alignItems: 'center', ...ghostBorder() },
    badgeIcon: {
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center',
        marginBottom: 16,
    },
    headerTitle: { fontSize: 20, fontWeight: '800', color: '#EAF3F6', marginBottom: 8, textAlign: 'center' },
    tagCode: {
        fontSize: 12, color: VOICES.rider.accent, fontFamily: 'monospace',
        backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 12, paddingVertical: 4,
        borderRadius: 8, marginBottom: 16, letterSpacing: 1,
    },
    body: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
    primaryBtn: {
        width: '100%', paddingVertical: 16, borderRadius: 16,
        backgroundColor: VOICES.rider.accent, alignItems: 'center',
    },
    primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#EAF3F6' },
});
