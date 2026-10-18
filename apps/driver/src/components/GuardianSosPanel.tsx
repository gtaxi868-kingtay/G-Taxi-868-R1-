import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { supabase } from '@gtaxi/core';

// G Guardian SOS panel. Shown on the ride screen once SOS is pressed and
// kept there until the ride ends or the rider closes it.
//
// The guarantee is the first button: it rings the G Guardian on-call line
// from the rider's own phone, so a person is one tap away even if no
// message or notification can be delivered. The status line only says a
// G Guardian "has your alert" once one has actually tapped "I'm on it"
// (my_sos_status), never before.

const FALLBACK_GUARDIAN = '18687031000';

function digits(phone: string) {
    return phone.replace(/\D/g, '');
}

export function GuardianSosPanel({
    rideId,
    guardianPhone,
    lat,
    lng,
    driverName,
    plate,
    showContactHint = true,
    onClose,
}: {
    rideId: string;
    guardianPhone?: string | null;
    lat?: number | null;
    lng?: number | null;
    driverName?: string | null;
    plate?: string | null;
    showContactHint?: boolean;
    onClose: () => void;
}) {
    const [phone, setPhone] = useState<string>(guardianPhone || FALLBACK_GUARDIAN);
    const [acknowledged, setAcknowledged] = useState(false);
    const [contact, setContact] = useState<{ name: string | null; phone: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        supabase.auth.getUser().then(({ data }: any) => {
            const uid = data?.user?.id;
            if (!uid) return;
            supabase.from('profiles')
                .select('emergency_contact_name, emergency_contact_phone')
                .eq('id', uid)
                .maybeSingle()
                .then(({ data: p }: any) => {
                    if (!cancelled && p?.emergency_contact_phone) {
                        setContact({ name: p.emergency_contact_name ?? null, phone: p.emergency_contact_phone });
                    }
                }, () => {});
        }, () => {});

        const poll = async () => {
            const { data } = await supabase.rpc('my_sos_status', { p_ride_id: rideId })
                .then((r: any) => r, () => ({ data: null }));
            if (cancelled || !data?.found) return;
            if (data.guardian_phone) setPhone(data.guardian_phone);
            if (data.acknowledged) setAcknowledged(true);
        };
        poll();
        const t = setInterval(poll, 8000);
        return () => { cancelled = true; clearInterval(t); };
    }, [rideId]);

    const where = lat != null && lng != null ? ` My location: https://maps.google.com/?q=${lat},${lng}` : '';
    const car = driverName || plate ? ` I'm in a G-Taxi${driverName ? ` with ${driverName}` : ''}${plate ? ` (${plate})` : ''}.` : '';
    const contactText = `SOS from G-Taxi: I need help.${car}${where}`;

    return (
        <View style={st.panel} accessibilityRole="alert">
            <Text style={st.title}>SOS ACTIVE</Text>
            <Text style={st.status}>
                {acknowledged
                    ? 'A G Guardian has your alert and is on it.'
                    : 'Your alert is with G Guardian. Call now to reach a person straight away.'}
            </Text>

            <TouchableOpacity style={[st.btn, st.primary]} onPress={() => Linking.openURL(`tel:+${digits(phone)}`)}
                accessibilityRole="button" accessibilityLabel="Call G Guardian">
                <Text style={st.primaryText}>CALL G GUARDIAN</Text>
            </TouchableOpacity>

            <View style={st.row}>
                <TouchableOpacity style={[st.btn, st.danger, st.half]} onPress={() => Linking.openURL('tel:999')}
                    accessibilityRole="button" accessibilityLabel="Call police 999">
                    <Text style={st.dangerText}>POLICE 999</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.btn, st.danger, st.half]} onPress={() => Linking.openURL('tel:811')}
                    accessibilityRole="button" accessibilityLabel="Call ambulance 811">
                    <Text style={st.dangerText}>AMBULANCE 811</Text>
                </TouchableOpacity>
            </View>

            {contact ? (
                <TouchableOpacity style={[st.btn, st.secondary]}
                    onPress={() => Linking.openURL(`https://wa.me/${digits(contact.phone)}?text=${encodeURIComponent(contactText)}`)}
                    accessibilityRole="button" accessibilityLabel="Text my emergency contact">
                    <Text style={st.secondaryText}>TEXT {contact.name ? contact.name.toUpperCase() : 'MY CONTACT'} MY LOCATION</Text>
                </TouchableOpacity>
            ) : showContactHint ? (
                <Text style={st.hint}>Tip: add an emergency contact in Settings so you can text them your location in one tap.</Text>
            ) : null}

            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Hide SOS panel">
                <Text style={st.close}>Hide</Text>
            </TouchableOpacity>
        </View>
    );
}

const st = StyleSheet.create({
    panel: { backgroundColor: 'rgba(20,6,8,0.96)', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(255,77,77,0.6)', marginTop: 12 },
    title: { color: '#FF4D4D', fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },
    status: { color: '#FFFFFF', fontSize: 15, marginTop: 6, marginBottom: 14, lineHeight: 21 },
    btn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
    primary: { backgroundColor: '#FF4D4D' },
    primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 17, letterSpacing: 1 },
    row: { flexDirection: 'row', gap: 10 },
    half: { flex: 1 },
    danger: { backgroundColor: 'rgba(255,77,77,0.18)', borderWidth: 1, borderColor: 'rgba(255,77,77,0.5)' },
    dangerText: { color: '#FFB3B3', fontWeight: '800', fontSize: 14 },
    secondary: { backgroundColor: 'rgba(255,255,255,0.08)' },
    secondaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
    hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 8 },
    close: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 13, paddingTop: 4 },
});
