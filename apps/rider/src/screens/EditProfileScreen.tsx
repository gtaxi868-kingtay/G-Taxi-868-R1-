import React, { useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, TextInput,
    Alert, KeyboardAvoidingView, Platform, Image,
    ScrollView, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '../design-system/primitives';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../../../shared/supabase';
import { decode } from 'base64-arraybuffer';

// ── Rider Design Tokens ──────────────────────────────────────────────────────
const R = {
    bg: '#07050F',
    surface: '#110E22',
    border: 'rgba(255,255,255,0.08)',
    purple: '#7C3AED',
    purpleLight: '#A78BFA',
    white: '#FFFFFF',
    muted: 'rgba(255,255,255,0.4)',
};

export function EditProfileScreen({ navigation }: any) {
    const { profile, refreshProfile, user } = useAuth();
    const insets = useSafeAreaInsets();

    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [phone, setPhone] = useState(profile?.phone || '');
    const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
            base64: true,
        });

        if (!result.canceled && result.assets[0].base64 && user) {
            try {
                setUploading(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const base64 = result.assets[0].base64;
                const filePath = `${user.id}/${Date.now()}.png`;

                const { error: uploadError } = await supabase.storage
                    .from('avatars')
                    .upload(filePath, decode(base64), { contentType: 'image/png', upsert: true });

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
                setAvatarUrl(publicUrl);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error: any) {
                Alert.alert('Upload Error', error.message);
            } finally {
                setUploading(false);
            }
        }
    };

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

        const { error } = await supabase
            .from('profiles')
            .update({ full_name: fullName, phone: phone, avatar_url: avatarUrl })
            .eq('id', user.id);

        if (error) {
            Alert.alert('Error', error.message);
        } else {
            await refreshProfile();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            navigation.goBack();
        }
        setSaving(false);
    };

    return (
        <View style={s.root}>
            <StatusBar style="light" />

            <BlurView tint="dark" intensity={80} style={[s.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBtn}>
                    <Txt variant="bodyBold" color={R.muted}>Cancel</Txt>
                </TouchableOpacity>
                <Txt variant="headingM" weight="heavy" color="#FFF">Edit Profile</Txt>
                <TouchableOpacity onPress={handleSave} disabled={saving} style={s.headerBtn}>
                    <Txt variant="bodyBold" color={R.purpleLight}>{saving ? '...' : 'Save'}</Txt>
                </TouchableOpacity>
            </BlurView>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={s.scroll}>

                    <TouchableOpacity style={s.photoGroup} onPress={pickImage} disabled={uploading}>
                        <LinearGradient colors={[R.purple, '#4C1D95']} style={s.avatarBorder}>
                            <View style={s.avatarInner}>
                                {avatarUrl ? (
                                    <Image source={{ uri: avatarUrl }} style={s.image} />
                                ) : (
                                    <Txt variant="headingL" weight="heavy" color="#FFF">{fullName.charAt(0) || '?'}</Txt>
                                )}
                                {uploading && <View style={s.overlay}><ActivityIndicator color="#FFF" /></View>}
                            </View>
                        </LinearGradient>
                        <Txt variant="caption" weight="heavy" color={R.purpleLight} style={{ marginTop: 16 }}>CHANGE PHOTO</Txt>
                    </TouchableOpacity>

                    <View style={s.form}>
                        <View style={s.inputContainer}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>FULL NAME</Txt>
                            <TextInput
                                style={s.input}
                                value={fullName}
                                onChangeText={setFullName}
                                placeholder="Enter your full name"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                            />
                        </View>

                        <View style={s.inputContainer}>
                            <Txt variant="caption" weight="heavy" color={R.muted} style={s.label}>PHONE NUMBER</Txt>
                            <TextInput
                                style={s.input}
                                value={phone}
                                onChangeText={setPhone}
                                placeholder="868-000-0000"
                                placeholderTextColor="rgba(255,255,255,0.2)"
                                keyboardType="phone-pad"
                            />
                            <Txt variant="small" color={R.muted} style={{ marginTop: 8 }}>Used for pickup coordination</Txt>
                        </View>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: R.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: R.border },
    headerBtn: { padding: 8, minWidth: 60, alignItems: 'center' },

    scroll: { padding: 32, alignItems: 'center' },
    photoGroup: { alignItems: 'center', marginBottom: 40 },
    avatarBorder: { width: 110, height: 110, borderRadius: 55, padding: 3, alignItems: 'center', justifyContent: 'center' },
    avatarInner: { width: 104, height: 104, borderRadius: 52, backgroundColor: R.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },

    form: { width: '100%', gap: 24 },
    inputContainer: { gap: 8 },
    label: { marginLeft: 4 },
    input: { height: 56, backgroundColor: R.surface, borderRadius: 16, paddingHorizontal: 20, color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: R.border },
});
